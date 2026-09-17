<?php
// ==========================================
// MSE Board — Configuração central (múltiplos departamentos)
// Lê as credenciais do arquivo .env (nunca deixe esses valores direto no
// código — o .env fica FORA da pasta pública, só o servidor lê ele).
//
// Vários "departamentos" (Programação, Planejamento, etc) compartilham o
// MESMO banco de dados — cada tabela (people, cards, board_state) tem uma
// coluna "department" que separa os dados de cada um. Cada endpoint filtra
// suas consultas por essa coluna, usando getCurrentDepartment().
// ==========================================

// Carrega o .env manualmente (sem precisar de biblioteca externa)
function loadEnv($path) {
    if (!file_exists($path)) return;
    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        if (strpos(trim($line), '#') === 0) continue; // comentário
        if (strpos($line, '=') === false) continue;
        list($key, $value) = explode('=', $line, 2);
        $key = trim($key);
        $value = trim($value);
        // Remove aspas se tiver
        $value = trim($value, "\"'");
        putenv("$key=$value");
        $_ENV[$key] = $value;
    }
}

// O .env fica na RAIZ do projeto (mse_board/.env), um nivel acima desta pasta.
loadEnv(__DIR__ . '/../.env');

// Lê uma variável do .env com valor padrão. O sso_helper.php depende dessa
// função — ela existia no config.php original e sumiu quando o arquivo foi
// reescrito, o que derrubava TODO login por SSO com
// "Call to undefined function env()".
function env($key, $default = null) {
    $value = getenv($key);
    if ($value === false) {
        $value = $_ENV[$key] ?? null;
    }
    return ($value === null || $value === '') ? $default : $value;
}

define('DB_HOST', getenv('DB_HOST') ?: 'localhost');
define('DB_NAME', getenv('DB_NAME') ?: 'mse_board');
define('DB_USER', getenv('DB_USER') ?: 'root');
define('DB_PASS', getenv('DB_PASS') ?: '');
define('API_SECRET', getenv('API_SECRET') ?: '');
define('ALLOWED_ORIGIN', getenv('ALLOWED_ORIGIN') ?: '*');

// Endereco base da API, entregue ao frontend pelo config.js.php.
define('API_BASE', getenv('API_BASE') ?: 'http://localhost/mse_board/mse-backend/api');

// Departamento padrão, usado se ninguém mandar o parâmetro "dept" — assim
// nenhum link/chamada antiga (de antes dessa mudança) quebra.
define('DEFAULT_DEPARTMENT', 'programacao');

// Departamentos conhecidos — pra adicionar um novo no futuro, só
// acrescenta o nome aqui (nada de banco novo: a separação é pela coluna
// "department" das tabelas).
$GLOBALS['KNOWN_DEPARTMENTS'] = ['programacao', 'planejamento'];

// Descobre qual departamento foi pedido nessa chamada — sempre pela query
// string (?dept=x). Importante: NÃO lemos o corpo da requisição aqui, já
// que cada endpoint só pode ler o corpo (php://input) uma vez — se a gente
// lesse aqui também, o endpoint receberia um corpo vazio depois.
function getCurrentDepartment() {
    $dept = $_GET['dept'] ?? DEFAULT_DEPARTMENT;

    // Só aceita departamentos conhecidos — evita alguém tentar mandar um
    // valor arbitrário pelo parâmetro.
    if (!in_array($dept, $GLOBALS['KNOWN_DEPARTMENTS'], true)) {
        $dept = DEFAULT_DEPARTMENT;
    }

    return $dept;
}

function getDbConnection() {
    static $pdo = null;

    if ($pdo === null) {
        $dsn = "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4";
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
    }

    return $pdo;
}

// Confere se quem está chamando manda a chave certa (X-API-Key), pra
// impedir que qualquer pessoa na internet leia/altere os dados do quadro.
function requireApiKey() {
    $headers = function_exists('getallheaders') ? getallheaders() : [];
    $sentKey = $headers['X-API-Key'] ?? $headers['x-api-key'] ?? ($_SERVER['HTTP_X_API_KEY'] ?? '');

    if (empty(API_SECRET) || $sentKey !== API_SECRET) {
        http_response_code(401);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Não autorizado.']);
        exit;
    }
}
