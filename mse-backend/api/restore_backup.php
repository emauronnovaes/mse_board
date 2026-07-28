<?php
// ==========================================
// MSE Board — POST: restaura um backup escolhido (SOBRESCREVE os dados atuais)
// ==========================================

require_once __DIR__ . '/../config.php';

header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;
requireApiKey();

$raw = file_get_contents('php://input');
$p = json_decode($raw, true);

if (!$p || empty($p['filename'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Falta o nome do arquivo de backup.']);
    exit;
}

// Só aceita nomes de arquivo dentro do padrão esperado, por segurança
$safeName = basename($p['filename']);
if (!preg_match('/^backup_[0-9_\-]+\.json$/', $safeName)) {
    http_response_code(400);
    echo json_encode(['error' => 'Nome de arquivo inválido.']);
    exit;
}

$fullPath = __DIR__ . '/../backups/' . $safeName;
if (!file_exists($fullPath)) {
    http_response_code(404);
    echo json_encode(['error' => 'Arquivo de backup não encontrado.']);
    exit;
}

$backup = json_decode(file_get_contents($fullPath), true);
if (!$backup) {
    http_response_code(400);
    echo json_encode(['error' => 'Arquivo de backup corrompido ou inválido.']);
    exit;
}

$pdo = getDbConnection();
$pdo->beginTransaction();

try {
    // Restaura o estado geral (membros, etiquetas, etc.)
    if (isset($backup['boardState'])) {
        $stmt = $pdo->prepare("UPDATE board_state SET data = :data WHERE id = 1");
        $stmt->execute(['data' => json_encode($backup['boardState'])]);
    }

    // Restaura pessoas
    if (isset($backup['people'])) {
        $pdo->exec("DELETE FROM people");
        $insertPerson = $pdo->prepare(
            "INSERT INTO people (id, name, avatar_url, is_done, member_email, position) VALUES (:id, :name, :avatar_url, :is_done, :member_email, :position)"
        );
        foreach ($backup['people'] as $p2) {
            $insertPerson->execute([
                'id' => $p2['id'], 'name' => $p2['name'], 'avatar_url' => $p2['avatar_url'],
                'is_done' => $p2['is_done'], 'member_email' => $p2['member_email'], 'position' => $p2['position']
            ]);
        }
    }

    // Restaura post-its
    if (isset($backup['cards'])) {
        $pdo->exec("DELETE FROM cards");
        $insertCard = $pdo->prepare(
            "INSERT INTO cards (id, person_id, title, color, priority, due_date, estimated_hours, worked_hours, project,
             author, status, sticker_id, cover_image, starred, archived, checklist, attachments, comments, assignees,
             label_ids, custom_values, created_at, completed_at)
             VALUES (:id, :person_id, :title, :color, :priority, :due_date, :estimated_hours, :worked_hours, :project,
             :author, :status, :sticker_id, :cover_image, :starred, :archived, :checklist, :attachments, :comments, :assignees,
             :label_ids, :custom_values, :created_at, :completed_at)"
        );
        foreach ($backup['cards'] as $c) {
            $insertCard->execute([
                'id' => $c['id'], 'person_id' => $c['person_id'], 'title' => $c['title'], 'color' => $c['color'],
                'priority' => $c['priority'], 'due_date' => $c['due_date'],
                'estimated_hours' => $c['estimated_hours'] ?? null, 'worked_hours' => $c['worked_hours'] ?? null,
                'project' => $c['project'] ?? null,
                'author' => $c['author'], 'status' => $c['status'], 'sticker_id' => $c['sticker_id'],
                'cover_image' => $c['cover_image'], 'starred' => $c['starred'], 'archived' => $c['archived'],
                'checklist' => $c['checklist'], 'attachments' => $c['attachments'], 'comments' => $c['comments'],
                'assignees' => $c['assignees'], 'label_ids' => $c['label_ids'], 'custom_values' => $c['custom_values'],
                'created_at' => $c['created_at'], 'completed_at' => $c['completed_at'] ?? null
            ]);
        }
    }

    $pdo->commit();
    echo json_encode(['success' => true]);
} catch (Throwable $e) {
    $pdo->rollBack();
    http_response_code(500);
    echo json_encode(['error' => 'Falha ao restaurar: ' . $e->getMessage()]);
}
