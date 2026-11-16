<?php
// ==========================================
// MSE Board — Sessão no servidor
//
// Antes, a API só pedia a X-API-Key — e essa chave ia pro navegador de
// qualquer visitante (config.js.php), ou seja, não protegia nada. Agora o
// login (senha em auth.php ou Portal em sso_login.php) cria uma sessão aqui e
// devolve um token aleatório; o navegador manda esse token em toda chamada
// (cabeçalho X-Session-Token). Sem token válido, a API responde 401.
//
// Token em cabeçalho (e não cookie) de propósito: o board abre dentro do
// iframe do Portal, e cookie de terceiros é bloqueado em vários navegadores.
// No banco fica só o sha256 do token — quem ler a tabela não consegue usar.
// ==========================================

const SESSAO_DIAS = 30;               // sessão parada por mais que isso expira
const CONTA_MASTER = 'admin@mse.com.br';

function garantirTabelaDeSessoes(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS board_sessions (
        token_hash CHAR(64) NOT NULL PRIMARY KEY,
        email VARCHAR(190) NOT NULL,
        criada_em DATETIME NOT NULL,
        usada_em DATETIME NOT NULL,
        KEY idx_board_sessions_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

function criarSessao(PDO $pdo, string $email): string {
    garantirTabelaDeSessoes($pdo);
    $token = bin2hex(random_bytes(32));
    $pdo->prepare("INSERT INTO board_sessions (token_hash, email, criada_em, usada_em) VALUES (:h, :e, NOW(), NOW())")
        ->execute(['h' => hash('sha256', $token), 'e' => strtolower(trim($email))]);
    // Limpeza das vencidas (aproveita o login, que é raro)
    $pdo->exec("DELETE FROM board_sessions WHERE usada_em < NOW() - INTERVAL " . SESSAO_DIAS . " DAY");
    return $token;
}

function tokenDaRequisicao(): string {
    $h = function_exists('getallheaders') ? getallheaders() : [];
    $t = $h['X-Session-Token'] ?? $h['x-session-token'] ?? ($_SERVER['HTTP_X_SESSION_TOKEN'] ?? '');
    return is_string($t) ? trim($t) : '';
}

// E-mail dono do token desta chamada, ou null (sem token, vencido ou inválido)
function emailDaSessao(PDO $pdo) {
    $token = tokenDaRequisicao();
    if (!preg_match('/^[0-9a-f]{64}$/', $token)) return null;
    $hash = hash('sha256', $token);
    try {
        $st = $pdo->prepare("SELECT email FROM board_sessions WHERE token_hash = :h AND usada_em >= NOW() - INTERVAL " . SESSAO_DIAS . " DAY");
        $st->execute(['h' => $hash]);
        $email = $st->fetchColumn();
        if ($email === false) return null;
        // Renova no máximo 1x por hora (evita uma escrita por chamada)
        $pdo->prepare("UPDATE board_sessions SET usada_em = NOW() WHERE token_hash = :h AND usada_em < NOW() - INTERVAL 1 HOUR")
            ->execute(['h' => $hash]);
        return (string) $email;
    } catch (PDOException $e) {
        return null; // tabela ainda não existe = ninguém logou depois da mudança
    }
}

function encerrarSessao(PDO $pdo): void {
    $token = tokenDaRequisicao();
    if (!preg_match('/^[0-9a-f]{64}$/', $token)) return;
    try {
        $pdo->prepare("DELETE FROM board_sessions WHERE token_hash = :h")->execute(['h' => hash('sha256', $token)]);
    } catch (PDOException $e) { /* nada a encerrar */ }
}

// Papel do e-mail no quadro do departamento (Admin, Membro, Observador) ou null
function papelNoQuadro(PDO $pdo, string $dept, string $email) {
    $st = $pdo->prepare("SELECT data FROM board_state WHERE department = :dept");
    $st->execute(['dept' => $dept]);
    $estado = json_decode((string) $st->fetchColumn(), true);
    $membros = (is_array($estado) && isset($estado['members']) && is_array($estado['members'])) ? $estado['members'] : [];
    foreach ($membros as $m => $papel) {
        if (strcasecmp(trim((string) $m), $email) === 0) return (string) $papel;
    }
    return null;
}

function negarAcesso(int $codigo, string $motivo): void {
    http_response_code($codigo);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $motivo]);
    exit;
}

// Exige alguém logado. Devolve o e-mail da sessão.
function requireSession(): string {
    $email = emailDaSessao(getDbConnection());
    if ($email === null) negarAcesso(401, 'sessao');
    return $email;
}

// Exige alguém logado com cargo Admin no quadro do ?dept= da chamada.
function requireAdminDoQuadro(): string {
    $email = requireSession();
    if (papelNoQuadro(getDbConnection(), getCurrentDepartment(), $email) !== 'Admin') negarAcesso(403, 'admin');
    return $email;
}

// Chave de API de verdade (não vai mais pro navegador): só pra rotinas do
// servidor, como o backup agendado. Não encerra a chamada; só diz se bate.
function chaveDeApiConfere(): bool {
    $h = function_exists('getallheaders') ? getallheaders() : [];
    $enviada = $h['X-API-Key'] ?? $h['x-api-key'] ?? ($_SERVER['HTTP_X_API_KEY'] ?? '');
    return API_SECRET !== '' && is_string($enviada) && hash_equals(API_SECRET, $enviada);
}

// Derruba as sessões de quem foi excluído do quadro ou teve a senha redefinida
function encerrarSessoesDe(PDO $pdo, array $emails): void {
    $emails = array_values(array_filter(array_map(function ($e) { return strtolower(trim((string) $e)); }, $emails)));
    if (!$emails) return;
    try {
        $marcas = implode(',', array_fill(0, count($emails), '?'));
        $pdo->prepare("DELETE FROM board_sessions WHERE email IN ($marcas)")->execute($emails);
    } catch (PDOException $e) { /* tabela ainda não existe */ }
}
