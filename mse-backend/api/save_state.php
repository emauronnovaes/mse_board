<?php
// ==========================================
// MSE Board — POST: salva o estado atual do quadro (do departamento pedido)
// Senhas e tentativas de login vêm SEMPRE do banco, nunca do navegador
// (ver auth_helper.php) — quem mexe nelas é só o auth.php.
// ==========================================

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../auth_helper.php';

header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit;
}
requireApiKey();

// Valida se realmente é um objeto JSON antes de gravar
$novo = json_decode(file_get_contents('php://input'));
if (!is_object($novo)) {
    http_response_code(400);
    echo json_encode(['error' => 'JSON inválido enviado pelo cliente.']);
    exit;
}

try {
    $pdo = getDbConnection();
    $dept = getCurrentDepartment();

    $pdo->beginTransaction();
    $atual = lerEstadoDoQuadro($pdo, $dept, true);
    removerCamposPrivados($novo);
    foreach (CAMPOS_PRIVADOS_DO_ESTADO as $campo) {
        if ($atual && isset($atual->$campo)) $novo->$campo = $atual->$campo;
    }
    gravarEstadoDoQuadro($pdo, $dept, $novo);
    $pdo->commit();

    echo json_encode(['success' => true]);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    http_response_code(500);
    echo json_encode(['error' => 'Falha ao salvar o estado do quadro.']);
}
