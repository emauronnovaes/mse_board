<?php
// ==========================================
// MSE Board — POST: login e senhas, conferidos NO SERVIDOR
//
// Antes o navegador baixava os hashes de senha de todo mundo e conferia lá.
// Agora os hashes não saem daqui (ver auth_helper.php).
//
// Ações (campo "action"):
//   exists  {email}            → {exists}
//   login   {email, password}  → {ok} | {ok:false, reason: sem_conta|senha|bloqueado|senha_padrao, minutos?}
//   signup  {email, password}  → {ok} | {ok:false, reason: existe|curta|email}
//   remove  {emails: [...]}    → {ok}   (excluir pessoa / redefinir senha)
// ==========================================

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../auth_helper.php';

header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;
requireApiKey();

$p = json_decode(file_get_contents('php://input'), true);
$acao = is_array($p) ? ($p['action'] ?? '') : '';
$email = strtolower(trim((string) ($p['email'] ?? '')));
$senha = (string) ($p['password'] ?? '');

const MAX_TENTATIVAS = 5;
const BLOQUEIO_MS = 15 * 60 * 1000;

try {
    $pdo = getDbConnection();
    $dept = getCurrentDepartment();
    garantirQuadroDoDepartamento($pdo, $dept);

    $pdo->beginTransaction();
    $estado = lerEstadoDoQuadro($pdo, $dept, true) ?: new stdClass();
    if (!isset($estado->userPasswords) || !is_object($estado->userPasswords)) $estado->userPasswords = new stdClass();
    if (!isset($estado->loginAttempts) || !is_object($estado->loginAttempts)) $estado->loginAttempts = new stdClass();
    $senhas = $estado->userPasswords;
    $tentativas = $estado->loginAttempts;
    $hash = ($email !== '' && isset($senhas->$email)) ? (string) $senhas->$email : '';

    $resposta = ['ok' => false, 'reason' => 'acao'];
    $mudou = false;

    if ($acao === 'exists') {
        $resposta = ['ok' => true, 'exists' => $hash !== ''];

    } elseif ($acao === 'login') {
        $agora = (int) round(microtime(true) * 1000);
        $info = isset($tentativas->$email) ? $tentativas->$email : null;

        if ($hash === '') {
            $resposta = ['ok' => false, 'reason' => 'sem_conta'];
        } elseif ($info && !empty($info->lockedUntil) && $agora < $info->lockedUntil) {
            $resposta = ['ok' => false, 'reason' => 'bloqueado', 'minutos' => (int) ceil(($info->lockedUntil - $agora) / 60000)];
        } elseif ($hash === HASH_SENHA_PADRAO_ADMIN) {
            $resposta = ['ok' => false, 'reason' => 'senha_padrao'];
        } elseif (!senhaConfere($senha, $hash)) {
            $info = $info ?: new stdClass();
            $info->count = (int) ($info->count ?? 0) + 1;
            if ($info->count >= MAX_TENTATIVAS) {
                $info->lockedUntil = $agora + BLOQUEIO_MS;
                $info->count = 0;
            }
            $tentativas->$email = $info;
            $mudou = true;
            $bloqueou = !empty($info->lockedUntil) && $agora < $info->lockedUntil;
            $resposta = ['ok' => false, 'reason' => $bloqueou ? 'bloqueado' : 'senha', 'minutos' => $bloqueou ? 15 : null];
        } else {
            unset($tentativas->$email);
            // Formato antigo (sha256): troca pelo atual agora que temos a senha
            if (strpos($hash, '$') !== 0) $senhas->$email = password_hash($senha, PASSWORD_DEFAULT);
            $mudou = true;
            $resposta = ['ok' => true];
        }

    } elseif ($acao === 'signup') {
        if (!preg_match('/^[^\s@]+@mse\.com\.br$/', $email)) {
            $resposta = ['ok' => false, 'reason' => 'email'];
        } elseif ($hash !== '') {
            $resposta = ['ok' => false, 'reason' => 'existe'];
        } elseif (strlen($senha) < 6) {
            $resposta = ['ok' => false, 'reason' => 'curta'];
        } else {
            $senhas->$email = password_hash($senha, PASSWORD_DEFAULT);
            $mudou = true;
            $resposta = ['ok' => true];
        }

    } elseif ($acao === 'remove') {
        foreach ((array) ($p['emails'] ?? []) as $e) {
            $e = strtolower(trim((string) $e));
            if ($e !== '' && isset($senhas->$e)) { unset($senhas->$e); $mudou = true; }
            if ($e !== '' && isset($tentativas->$e)) { unset($tentativas->$e); $mudou = true; }
        }
        $resposta = ['ok' => true];
    }

    if ($mudou) gravarEstadoDoQuadro($pdo, $dept, $estado);
    $pdo->commit();
    echo json_encode($resposta);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    http_response_code(500);
    echo json_encode(['error' => 'Falha na autenticação.']);
}
