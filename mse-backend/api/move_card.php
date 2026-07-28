<?php
// ==========================================
// MSE Board — POST: move um post-it (arrastar entre colunas/raias)
// Endpoint leve — só troca person_id/status/completed_at, não reenvia o post-it inteiro.
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

if (!$p || empty($p['id']) || empty($p['personId'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Faltam id e personId.']);
    exit;
}

$pdo = getDbConnection();

$stmt = $pdo->prepare(
    "UPDATE cards SET person_id = :person_id,
     status = COALESCE(:status, status),
     completed_at = :completed_at
     WHERE id = :id"
);
$stmt->execute([
    'person_id' => $p['personId'],
    'status' => $p['status'] ?? null,
    'completed_at' => array_key_exists('completedAt', $p) ? $p['completedAt'] : null,
    'id' => $p['id']
]);

echo json_encode(['success' => true]);
