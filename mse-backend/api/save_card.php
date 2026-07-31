<?php
// ==========================================
// MSE Board — POST: cria ou atualiza um post-it inteiro
// ==========================================

require_once __DIR__ . '/../config.php';

header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;
requireApiKey();

$raw = file_get_contents('php://input');
if (strlen($raw) > 10 * 1024 * 1024) {
    http_response_code(413);
    echo json_encode(['error' => 'Post-it grande demais (limite de 10 MB, provavelmente por causa de anexos/capa).']);
    exit;
}

$c = json_decode($raw, true);

if (!$c || empty($c['id']) || empty($c['personId'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Dados do post-it incompletos (precisa de id e personId).']);
    exit;
}

$pdo = getDbConnection();

$stmt = $pdo->prepare(
    "INSERT INTO cards
        (id, person_id, title, color, priority, due_date, start_date, estimated_hours, worked_hours, project, author, status, sticker_id, cover_image,
         starred, archived, checklist, attachments, comments, assignees, label_ids, custom_values, created_at, completed_at, observacao)
     VALUES
        (:id, :person_id, :title, :color, :priority, :due_date, :start_date, :estimated_hours, :worked_hours, :project, :author, :status, :sticker_id, :cover_image,
         :starred, :archived, :checklist, :attachments, :comments, :assignees, :label_ids, :custom_values, :created_at, :completed_at, :observacao)
     ON DUPLICATE KEY UPDATE
        person_id = VALUES(person_id),
        title = VALUES(title),
        color = VALUES(color),
        priority = VALUES(priority),
        due_date = VALUES(due_date),
        start_date = VALUES(start_date),
        estimated_hours = VALUES(estimated_hours),
        worked_hours = VALUES(worked_hours),
        project = VALUES(project),
        status = VALUES(status),
        sticker_id = VALUES(sticker_id),
        cover_image = VALUES(cover_image),
        starred = VALUES(starred),
        archived = VALUES(archived),
        checklist = VALUES(checklist),
        attachments = VALUES(attachments),
        comments = VALUES(comments),
        assignees = VALUES(assignees),
        label_ids = VALUES(label_ids),
        custom_values = VALUES(custom_values),
        completed_at = VALUES(completed_at),
        observacao = VALUES(observacao)"
);

$stmt->execute([
    'id' => $c['id'],
    'person_id' => $c['personId'],
    'title' => $c['title'],
    'color' => $c['color'] ?? 'yellow',
    'priority' => $c['priority'] ?? 'media',
    'due_date' => $c['dueDate'] ?? null,
    'start_date' => $c['startDate'] ?? null,
    'estimated_hours' => $c['estimatedHours'] ?? null,
    'worked_hours' => $c['workedHours'] ?? null,
    'project' => $c['project'] ?? null,
    'author' => $c['author'] ?? null,
    'status' => $c['status'] ?? 'todo',
    'sticker_id' => $c['stickerId'] ?? null,
    'cover_image' => $c['coverImage'] ?? null,
    'starred' => !empty($c['starred']) ? 1 : 0,
    'archived' => !empty($c['archived']) ? 1 : 0,
    'checklist' => json_encode($c['checklist'] ?? []),
    'attachments' => json_encode($c['attachments'] ?? []),
    'comments' => json_encode($c['comments'] ?? []),
    'assignees' => json_encode($c['assignees'] ?? []),
    'label_ids' => json_encode($c['labelIds'] ?? []),
    'custom_values' => json_encode($c['customValues'] ?? (object)[]),
    'created_at' => $c['createdAt'] ?? round(microtime(true) * 1000),
    'completed_at' => $c['completedAt'] ?? null,
    'observacao' => $c['observacao'] ?? ''
]);

echo json_encode(['success' => true]);
