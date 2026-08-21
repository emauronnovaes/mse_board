<?php
// ==========================================
// MSE Board — POST: exclui um post-it
// ==========================================

require_once __DIR__ . '/../config.php';

header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;
requireApiKey();

$raw = file_get_contents('php://input');
$c = json_decode($raw, true);

if (!$c || empty($c['id'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Falta o id do post-it.']);
    exit;
}

$pdo = getDbConnection();

try {
    $stmt = $pdo->prepare("DELETE FROM cards WHERE id = :id");
    $stmt->execute(['id' => $c['id']]);
    echo json_encode(['success' => true]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Falha ao excluir o post-it.', 'details' => $e->getMessage()]);
}
