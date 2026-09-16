<?php
// ==========================================
// MSE Board — POST: salva o estado atual do quadro (do departamento pedido)
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
$dept = getCurrentDepartment();

try {
    $stmt = $pdo->prepare("UPDATE board_state SET data = :data WHERE department = :dept");
    $stmt->execute(['data' => $raw, 'dept' => $dept]);

    // Se por algum motivo o registro ainda não existir, cria agora
    if ($stmt->rowCount() === 0) {
        $check = $pdo->prepare("SELECT COUNT(*) FROM board_state WHERE department = :dept");
        $check->execute(['dept' => $dept]);
        if ($check->fetchColumn() == 0) {
            $insert = $pdo->prepare("INSERT INTO board_state (department, data) VALUES (:dept, :data)");
            $insert->execute(['dept' => $dept, 'data' => $raw]);
        }
    }

    echo json_encode(['success' => true]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Falha ao salvar o estado do quadro.', 'details' => $e->getMessage()]);
}
