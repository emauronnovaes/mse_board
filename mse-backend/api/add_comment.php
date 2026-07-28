<?php
// ==========================================
// MSE Board — POST: adiciona um comentário a um post-it
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

if (!$p || empty($p['cardId']) || empty($p['author']) || !isset($p['text'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Faltam cardId, author e text.']);
    exit;
}

$pdo = getDbConnection();
$pdo->beginTransaction();

$stmt = $pdo->prepare("SELECT comments FROM cards WHERE id = :id FOR UPDATE");
$stmt->execute(['id' => $p['cardId']]);
$row = $stmt->fetch(PDO::FETCH_ASSOC);

if (!$row) {
    $pdo->rollBack();
    http_response_code(404);
    echo json_encode(['error' => 'Post-it não encontrado.']);
    exit;
}

$comments = json_decode($row['comments'] ?? '[]', true);
$comments[] = [
    'author' => $p['author'],
    'text' => $p['text'],
    'date' => round(microtime(true) * 1000)
];

$update = $pdo->prepare("UPDATE cards SET comments = :comments WHERE id = :id");
$update->execute(['comments' => json_encode($comments), 'id' => $p['cardId']]);

$pdo->commit();

echo json_encode(['success' => true, 'comments' => $comments]);
