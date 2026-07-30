<?php
// ==========================================
// MSE Board — POST: salva a nova ordem das colunas (pessoas), depois de arrastar
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

if (!$p || !isset($p['order']) || !is_array($p['order'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Falta o array "order" com os ids das colunas na ordem desejada.']);
    exit;
}

$pdo = getDbConnection();
$stmt = $pdo->prepare("UPDATE people SET position = :position WHERE id = :id");

$pdo->beginTransaction();
foreach ($p['order'] as $index => $personId) {
    $stmt->execute(['position' => $index, 'id' => $personId]);
}
$pdo->commit();

echo json_encode(['success' => true]);
