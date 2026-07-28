<?php
// ==========================================
// MSE Board — SSO: herda o login a partir de um token do Portal MSE
// Recebe ?sso=<token> (ou {"token": "..."} no corpo), valida a assinatura e a
// expiração, confere se o email tem acesso liberado (está em board_state.members)
// e devolve os dados da sessão para o frontend criar o login sem senha.
// ==========================================

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../sso_helper.php';

header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit;
}

// --- Coleta o token de várias formas possíveis ---
$token = '';
$raw = file_get_contents('php://input');
if ($raw !== '' && $raw !== false) {
    $body = json_decode($raw, true);
    if (is_array($body) && !empty($body['token'])) {
        $token = (string) $body['token'];
    }
}
if ($token === '' && !empty($_POST['token'])) {
    $token = (string) $_POST['token'];
}
if ($token === '' && !empty($_GET['sso'])) {
    $token = (string) $_GET['sso'];
}
if ($token === '' && !empty($_GET['token'])) {
    $token = (string) $_GET['token'];
}

// --- Valida assinatura e expiração ---
$resultado = superAppSsoValidarToken($token);
if (!$resultado['ok']) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'reason' => $resultado['reason']]);
    exit;
}

$payload = $resultado['payload'];
$email = strtolower(trim((string) $payload['email']));

// --- Confere se o email tem acesso liberado (está em board_state.members) ---
$pdo = getDbConnection();
$stmt = $pdo->query("SELECT data FROM board_state WHERE id = 1");
$row = $stmt->fetch(PDO::FETCH_ASSOC);
$board = ($row && $row['data']) ? json_decode($row['data'], true) : [];

$members = (is_array($board) && isset($board['members']) && is_array($board['members']))
    ? $board['members']
    : [];

$roleEncontrada = null;
foreach ($members as $memberEmail => $memberRole) {
    if (strcasecmp(trim((string) $memberEmail), $email) === 0) {
        $roleEncontrada = (string) $memberRole;
        break;
    }
}

if ($roleEncontrada === null || $roleEncontrada === '') {
    // Token válido, mas o email não está entre os usuários liberados neste quadro.
    http_response_code(403);
    echo json_encode(['ok' => false, 'reason' => 'sem_acesso', 'email' => $email]);
    exit;
}

// --- Sucesso: devolve os dados da sessão ---
// name = email para manter compatibilidade com o resto do sistema, que usa o
// email como identificador do usuário (getMemberRole, avatares, menções, etc.).
echo json_encode([
    'ok'          => true,
    'email'       => $email,
    'name'        => $email,
    'role'        => $roleEncontrada,
    'nome_portal' => isset($payload['nome']) ? (string) $payload['nome'] : '',
    'origem'      => isset($payload['origem']) ? (string) $payload['origem'] : ''
]);
