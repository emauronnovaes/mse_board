<?php
// ==========================================
// MSE Board — Senhas e campos privados do estado do quadro
//
// As senhas (hashes) e o controle de tentativas de login moram dentro do
// board_state, mas NUNCA saem do servidor: get_state.php remove esses campos
// antes de responder e save_state.php mantém os que já estão no banco
// (ignora o que vier do navegador). Quem confere/cria senha é o auth.php.
// ==========================================

const CAMPOS_PRIVADOS_DO_ESTADO = ['userPasswords', 'loginAttempts'];

// Hash da senha padrão antiga do admin@mse.com.br ("admin123"), que estava
// escrita no código público. Login com ela fica recusado.
const HASH_SENHA_PADRAO_ADMIN = 'e8eda0d35f19623f:b087c63fcb3b0a7b5c32e7ce04ff85f58df14c514cf1068392cb92e007b3bf82';

// Lê o estado do departamento como objeto (stdClass, pra {} continuar {} ao
// regravar). $travar = true usa SELECT ... FOR UPDATE (dentro de transação).
function lerEstadoDoQuadro(PDO $pdo, string $dept, bool $travar = false) {
    $sql = "SELECT data FROM board_state WHERE department = :dept" . ($travar ? " FOR UPDATE" : "");
    $stmt = $pdo->prepare($sql);
    $stmt->execute(['dept' => $dept]);
    $raw = $stmt->fetchColumn();
    if ($raw === false || $raw === null || $raw === '') return null;
    $obj = json_decode($raw);
    return is_object($obj) ? $obj : null;
}

function gravarEstadoDoQuadro(PDO $pdo, string $dept, $obj): void {
    $json = json_encode($obj, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $stmt = $pdo->prepare("UPDATE board_state SET data = :data WHERE department = :dept");
    $stmt->execute(['data' => $json, 'dept' => $dept]);
    if ($stmt->rowCount() === 0) {
        $check = $pdo->prepare("SELECT COUNT(*) FROM board_state WHERE department = :dept");
        $check->execute(['dept' => $dept]);
        if ((int) $check->fetchColumn() === 0) {
            $pdo->prepare("INSERT INTO board_state (department, data) VALUES (:dept, :data)")
                ->execute(['dept' => $dept, 'data' => $json]);
        }
    }
}

function removerCamposPrivados($obj) {
    foreach (CAMPOS_PRIVADOS_DO_ESTADO as $campo) unset($obj->$campo);
    return $obj;
}

// Confere a senha contra qualquer formato já gravado:
// bcrypt/argon (atual), "sal:sha256" (antigo) e sha256 puro (mais antigo).
function senhaConfere(string $senha, string $hash): bool {
    if (strpos($hash, '$') === 0) return password_verify($senha, $hash);
    if (strpos($hash, ':') !== false) {
        list($sal, $h) = explode(':', $hash, 2);
        return hash_equals($h, hash('sha256', $sal . ':' . $senha));
    }
    return hash_equals($hash, hash('sha256', $senha));
}
