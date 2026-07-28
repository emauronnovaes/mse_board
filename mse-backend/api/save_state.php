<?php
// ==========================================
// MSE Board — POST: salva o estado atual do quadro
// ==========================================

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit;
}

require_once __DIR__ . '/../config.php';

$raw = file_get_contents('php://input');

// Valida se realmente é um JSON antes de gravar
json_decode($raw);
if (json_last_error() !== JSON_ERROR_NONE) {
    http_response_code(400);
    echo json_encode(['error' => 'JSON inválido enviado pelo cliente.']);
    exit;
}

$pdo = getDbConnection();

$stmt = $pdo->prepare("UPDATE board_state SET data = :data WHERE id = 1");
$stmt->execute(['data' => $raw]);

// Se por algum motivo o registro ainda não existir, cria agora
if ($stmt->rowCount() === 0) {
    $check = $pdo->query("SELECT COUNT(*) FROM board_state WHERE id = 1")->fetchColumn();
    if ($check == 0) {
        $insert = $pdo->prepare("INSERT INTO board_state (id, data) VALUES (1, :data)");
        $insert->execute(['data' => $raw]);
    }
}

echo json_encode(['success' => true]);
