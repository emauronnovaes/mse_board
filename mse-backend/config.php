<?php
// ==========================================
// MSE Board — Configuração da conexão com o MySQL
// ==========================================
// Os valores sensíveis (banco, chaves, tokens) ficam no arquivo ".env" na raiz
// do projeto (mse_board/.env), que NÃO vai para o Git. Use ".env.example" como
// modelo. Ajuste o ".env" conforme o seu ambiente (XAMPP local, servidor, etc.).

// --- Carrega as variáveis do arquivo .env (raiz do projeto) ---
(function () {
    $envPath = __DIR__ . '/../.env';
    if (!is_file($envPath)) {
        return;
    }
    foreach (file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') {
            continue;
        }
        if (strpos($line, '=') === false) {
            continue;
        }
        list($name, $value) = explode('=', $line, 2);
        $name = trim($name);
        $value = trim($value);
        // Remove aspas envolvendo o valor, se houver
        $len = strlen($value);
        if ($len >= 2
            && ($value[0] === '"' || $value[0] === "'")
            && $value[$len - 1] === $value[0]) {
            $value = substr($value, 1, -1);
        }
        if (getenv($name) === false) {
            putenv("$name=$value");
        }
        $_ENV[$name] = $value;
    }
})();

function env($key, $default = null) {
    $value = getenv($key);
    if ($value === false) {
        $value = $_ENV[$key] ?? null;
    }
    return ($value === null || $value === '') ? $default : $value;
}

$DB_HOST = env('DB_HOST', 'localhost');
$DB_NAME = env('DB_NAME', 'mse_board');
$DB_USER = env('DB_USER', 'root');
$DB_PASS = env('DB_PASS', '');

// Chave secreta que protege a API — só quem souber esse valor consegue
// ler ou gravar dados. Precisa ser IGUAL à chave usada pelo frontend
// (entregue automaticamente via config.js.php, que lê o mesmo .env).
define('API_SECRET', env('API_SECRET', ''));

// Origem permitida a chamar a API (o endereço de onde o site é servido).
define('ALLOWED_ORIGIN', env('ALLOWED_ORIGIN', 'http://localhost'));

// Token separado, só pra o webhook de sugestões (usado pelo GPT Maker ou qualquer
// outra ferramenta externa). É de propósito diferente do API_SECRET acima —
// assim dá pra revogar/trocar sem afetar o resto do site.
define('SUGGESTIONS_WEBHOOK_TOKEN', env('SUGGESTIONS_WEBHOOK_TOKEN', ''));

// Endereço base da API usado pelo frontend (repassado via config.js.php).
define('API_BASE', env('API_BASE', 'http://localhost/mse_board/mse-backend/api'));

function requireApiKey() {
    $provided = $_SERVER['HTTP_X_API_KEY'] ?? '';
    if (!hash_equals(API_SECRET, $provided)) {
        http_response_code(401);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Não autorizado. Chave de API ausente ou incorreta.']);
        exit;
    }
}

function getDbConnection() {
    global $DB_HOST, $DB_NAME, $DB_USER, $DB_PASS;

    try {
        $pdo = new PDO(
            "mysql:host=$DB_HOST;dbname=$DB_NAME;charset=utf8mb4",
            $DB_USER,
            $DB_PASS
        );
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        return $pdo;
    } catch (PDOException $e) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode([
            'error' => 'Não foi possível conectar ao banco de dados.',
            'details' => $e->getMessage()
        ]);
        exit;
    }
}
