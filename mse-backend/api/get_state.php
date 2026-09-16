<?php
// ==========================================
// MSE Board — GET: retorna o estado atual do quadro (do departamento pedido)
// ==========================================

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit;
}

require_once __DIR__ . '/../config.php';

try {
    $pdo = getDbConnection();
    $dept = getCurrentDepartment();
    $stmt = $pdo->prepare("SELECT data FROM board_state WHERE department = :dept");
    $stmt->execute(['dept' => $dept]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($row && $row['data']) {
        // Já retorna o JSON puro (não precisa re-encodar, o banco já guarda JSON como texto)
        echo $row['data'];
    } else {
        echo '{}';
    }
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Falha ao buscar o estado do quadro.', 'details' => $e->getMessage()]);
}
