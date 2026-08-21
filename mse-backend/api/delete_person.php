<?php
// ==========================================
// MSE Board — POST: exclui uma pessoa/coluna
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

if (!$p || empty($p['id'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Falta o id da pessoa.']);
    exit;
}

$pdo = getDbConnection();

try {
    // Exclui também os post-its dessa pessoa (já devem ter sido movidos pra lixeira pelo site antes de chamar isso)
    $del1 = $pdo->prepare("DELETE FROM cards WHERE person_id = :id");
    $del1->execute(['id' => $p['id']]);

    $del2 = $pdo->prepare("DELETE FROM people WHERE id = :id");
    $del2->execute(['id' => $p['id']]);

    echo json_encode(['success' => true]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Falha ao excluir a pessoa/coluna.', 'details' => $e->getMessage()]);
}
