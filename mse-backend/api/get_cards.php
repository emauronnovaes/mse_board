<?php
// ==========================================
// MSE Board — GET: lista todos os post-its
// ==========================================

ini_set('display_errors', '0'); // nunca deixa o PHP imprimir erro em HTML no meio do JSON
error_reporting(E_ALL);

require_once __DIR__ . '/../config.php';

header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;
requireApiKey();

try {
    $pdo = getDbConnection();
    $stmt = $pdo->query("SELECT * FROM cards ORDER BY created_at ASC");
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $cards = array_map(function ($r) {
        return [
            'id' => $r['id'],
            'personId' => $r['person_id'],
            'title' => $r['title'],
            'color' => $r['color'],
            'priority' => $r['priority'],
            'dueDate' => $r['due_date'],
            'startDate' => $r['start_date'] ?? null,
            'observacao' => $r['observacao'] ?? '',
            'manualProgress' => isset($r['manual_progress']) && $r['manual_progress'] !== null ? (int) $r['manual_progress'] : null,
            'hiddenFromDashboard' => isset($r['hidden_from_dashboard']) ? (bool) $r['hidden_from_dashboard'] : false,
            'estimatedHours' => $r['estimated_hours'] !== null ? (float) $r['estimated_hours'] : null,
            'workedHours' => $r['worked_hours'] !== null ? (float) $r['worked_hours'] : null,
            'project' => $r['project'],
            'author' => $r['author'],
            'status' => $r['status'],
            'stickerId' => $r['sticker_id'],
            'coverImage' => $r['cover_image'],
            'starred' => (bool) $r['starred'],
            'archived' => (bool) $r['archived'],
            'checklist' => json_decode($r['checklist'] ?? '[]', true) ?? [],
            'attachments' => json_decode($r['attachments'] ?? '[]', true) ?? [],
            'comments' => json_decode($r['comments'] ?? '[]', true) ?? [],
            'assignees' => json_decode($r['assignees'] ?? '[]', true) ?? [],
            'labelIds' => json_decode($r['label_ids'] ?? '[]', true) ?? [],
            'customValues' => json_decode($r['custom_values'] ?? '{}', true) ?? (object)[],
            'createdAt' => $r['created_at'] !== null ? (int) $r['created_at'] : null,
            'completedAt' => $r['completed_at'] !== null ? (int) $r['completed_at'] : null
        ];
    }, $rows);

    echo json_encode($cards);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'error' => 'Erro ao buscar post-its.',
        'details' => $e->getMessage()
    ]);
}
