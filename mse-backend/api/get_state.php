<?php
// ==========================================
// MSE Board — GET: retorna o estado atual do quadro (do departamento pedido)
// Senhas e tentativas de login NÃO saem daqui (ver auth_helper.php).
// ==========================================

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../auth_helper.php';

header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit;
}
requireApiKey();

try {
    $pdo = getDbConnection();
    $dept = getCurrentDepartment();
    garantirQuadroDoDepartamento($pdo, $dept); // quadro novo: nasce com os Admins do molde
    $estado = lerEstadoDoQuadro($pdo, $dept);

    if ($estado) {
        echo json_encode(removerCamposPrivados($estado), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    } else {
        echo '{}';
    }
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Falha ao buscar o estado do quadro.']);
}
