<?php
// ==========================================
// MSE Board — POST: marca/desmarca um item do checklist
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

if (!$p || empty($p['cardId']) || !isset($p['itemIndex'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Faltam cardId e itemIndex.']);
    exit;
}

$pdo = getDbConnection();
$pdo->beginTransaction();

$stmt = $pdo->prepare("SELECT checklist FROM cards WHERE id = :id FOR UPDATE");
$stmt->execute(['id' => $p['cardId']]);
$row = $stmt->fetch(PDO::FETCH_ASSOC);

if (!$row) {
    $pdo->rollBack();
    http_response_code(404);
    echo json_encode(['error' => 'Post-it não encontrado.']);
    exit;
}

$checklist = json_decode($row['checklist'] ?? '[]', true);
$idx = (int) $p['itemIndex'];

if (!isset($checklist[$idx])) {
    $pdo->rollBack();
    http_response_code(400);
    echo json_encode(['error' => 'Item do checklist não existe.']);
    exit;
}

$checklist[$idx]['checked'] = !$checklist[$idx]['checked'];

$update = $pdo->prepare("UPDATE cards SET checklist = :checklist WHERE id = :id");
$update->execute(['checklist' => json_encode($checklist), 'id' => $p['cardId']]);

$pdo->commit();

echo json_encode(['success' => true, 'checklist' => $checklist]);
