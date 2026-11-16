<?php
// ==========================================
// MSE Board — POST: login e senhas, conferidos NO SERVIDOR
//
// Antes o navegador baixava os hashes de senha de todo mundo e conferia lá.
// Agora os hashes não saem daqui (ver auth_helper.php), e o login certo cria
// uma sessão no servidor (ver session_helper.php) — o token volta pro
// navegador e vai em toda chamada da API.
//
// Ações (campo "action"):
//   login   {email, password}  → {ok, token, role} | {ok:false, reason: sem_conta|senha|bloqueado|senha_padrao|pendente, minutos?}
//   signup  {email, password}  → {ok, token, role} | {ok:false, reason: existe|curta|email|portal|pendente}
//   pedir_redefinicao {email}  → {ok}   ("Esqueci a senha" — vai pro Admin do quadro)
//   remove  {emails, liberar?} → {ok}   (só Admin; liberar = pode criar senha nova)
//   logout                     → {ok}
//
// Membro do quadro só cria senha se um Admin liberar (Redefinir): quase todo
// mundo entra pelo Portal e não tem senha — sem essa trava, quem soubesse o
// e-mail de um colega criaria a senha dele e entraria no lugar.
// Quem ainda não é membro cria a conta e fica aguardando aprovação.
// ==========================================

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../auth_helper.php';

header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key, X-Session-Token');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;

$p = json_decode(file_get_contents('php://input'), true);
$acao = is_array($p) ? ($p['action'] ?? '') : '';
$email = strtolower(trim((string) ($p['email'] ?? '')));
$senha = (string) ($p['password'] ?? '');

const MAX_TENTATIVAS = 5;
const BLOQUEIO_MS = 15 * 60 * 1000;

// Papel do e-mail na lista de membros do estado (objeto), ou null
function papelNoEstado($estado, string $email) {
    if (!isset($estado->members) || !is_object($estado->members)) return null;
    foreach ($estado->members as $m => $papel) {
        if (strcasecmp(trim((string) $m), $email) === 0) return (string) $papel;
    }
    return null;
}

function emListaDoEstado($estado, string $campo, string $email): bool {
    return isset($estado->$campo) && is_array($estado->$campo) && in_array($email, $estado->$campo, true);
}

function incluirNaListaDoEstado($estado, string $campo, string $email): void {
    if (!isset($estado->$campo) || !is_array($estado->$campo)) $estado->$campo = [];
    if (!in_array($email, $estado->{$campo}, true)) $estado->{$campo}[] = $email;
}

try {
    $pdo = getDbConnection();
    $dept = getCurrentDepartment();
    garantirQuadroDoDepartamento($pdo, $dept);

    if ($acao === 'logout') {
        encerrarSessao($pdo);
        echo json_encode(['ok' => true]);
        exit;
    }

    // Quem está chamando (só importa pro "remove")
    $emailDaSessao = ($acao === 'remove') ? requireSession() : null;

    $pdo->beginTransaction();
    $estado = lerEstadoDoQuadro($pdo, $dept, true) ?: new stdClass();
    if (!isset($estado->userPasswords) || !is_object($estado->userPasswords)) $estado->userPasswords = new stdClass();
    if (!isset($estado->loginAttempts) || !is_object($estado->loginAttempts)) $estado->loginAttempts = new stdClass();
    $senhas = $estado->userPasswords;
    $tentativas = $estado->loginAttempts;
    $hash = ($email !== '' && isset($senhas->$email)) ? (string) $senhas->$email : '';

    $resposta = ['ok' => false, 'reason' => 'acao'];
    $mudou = false;
    $entrou = false; // senha conferida/criada: falta decidir se é membro

    if ($acao === 'login') {
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
            $entrou = true;
        }

    } elseif ($acao === 'signup') {
        $papel = papelNoEstado($estado, $email);
        if (!preg_match('/^[^\s@]+@mse\.com\.br$/', $email)) {
            $resposta = ['ok' => false, 'reason' => 'email'];
        } elseif ($hash !== '') {
            $resposta = ['ok' => false, 'reason' => 'existe'];
        } elseif (strlen($senha) < 6) {
            $resposta = ['ok' => false, 'reason' => 'curta'];
        } elseif ($papel !== null && !emListaDoEstado($estado, 'senhaLiberada', $email)) {
            $resposta = ['ok' => false, 'reason' => 'portal'];
        } else {
            $senhas->$email = password_hash($senha, PASSWORD_DEFAULT);
            if (isset($estado->senhaLiberada) && is_array($estado->senhaLiberada)) {
                $estado->senhaLiberada = array_values(array_diff($estado->senhaLiberada, [$email]));
            }
            $mudou = true;
            $entrou = true;
        }

    } elseif ($acao === 'pedir_redefinicao') {
        if (preg_match('/^[^\s@]+@mse\.com\.br$/', $email) && $email !== CONTA_MASTER) {
            incluirNaListaDoEstado($estado, 'passwordResetRequests', $email);
            $mudou = true;
        }
        $resposta = ['ok' => true];

    } elseif ($acao === 'remove') {
        if (papelNoEstado($estado, $emailDaSessao) !== 'Admin') {
            $pdo->rollBack();
            negarAcesso(403, 'admin');
        }
        $liberar = !empty($p['liberar']);
        foreach ((array) ($p['emails'] ?? []) as $e) {
            $e = strtolower(trim((string) $e));
            if ($e === '') continue;
            if ($e === CONTA_MASTER && $emailDaSessao !== CONTA_MASTER) continue; // conta master: só ela mesma
            if (isset($senhas->$e)) { unset($senhas->$e); $mudou = true; }
            if (isset($tentativas->$e)) { unset($tentativas->$e); $mudou = true; }
            if ($liberar) { incluirNaListaDoEstado($estado, 'senhaLiberada', $e); $mudou = true; }
        }
        $resposta = ['ok' => true];
    }

    // Senha certa: membro (ou primeiro acesso de um quadro sem ninguém) ganha
    // sessão; quem não é membro fica na fila de aprovação do Admin.
    $papel = null;
    if ($entrou) {
        $papel = papelNoEstado($estado, $email);
        $quadroVazio = !isset($estado->members) || count((array) $estado->members) === 0;
        if ($papel === null && $quadroVazio) {
            if (!isset($estado->members) || !is_object($estado->members)) $estado->members = new stdClass();
            $estado->members->$email = 'Admin';
            $papel = 'Admin';
        }
        if ($papel === null) {
            incluirNaListaDoEstado($estado, 'pendingApprovals', $email);
            $resposta = ['ok' => false, 'reason' => 'pendente'];
        }
    }

    if ($mudou || $entrou) gravarEstadoDoQuadro($pdo, $dept, $estado);
    $pdo->commit();

    // Excluído do quadro / senha redefinida: sai de todo lugar onde estava logado
    if ($acao === 'remove') {
        $saem = array_filter((array) ($p['emails'] ?? []), function ($e) use ($emailDaSessao) {
            $e = strtolower(trim((string) $e));
            return $e !== CONTA_MASTER || $emailDaSessao === CONTA_MASTER;
        });
        encerrarSessoesDe($pdo, $saem);
    }

    if ($entrou && $papel !== null) {
        $resposta = ['ok' => true, 'token' => criarSessao($pdo, $email), 'role' => $papel];
    }
    echo json_encode($resposta);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    http_response_code(500);
    echo json_encode(['error' => 'Falha na autenticação.']);
}
