<?php
// ==========================================
// MSE Board — Configuração central (múltiplos departamentos)
// Lê as credenciais do arquivo .env (nunca deixe esses valores direto no
// código — o .env fica FORA da pasta pública, só o servidor lê ele).
//
// Um único backend/banco de código atende vários "departamentos" (quadros
// separados, ex: Programação e Planejamento) — cada um com seu PRÓPRIO
// banco de dados, escolhido pelo parâmetro "dept" que o front-end manda
// em toda chamada (?dept=planejamento). Sem misturar dados entre eles.
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

loadEnv(__DIR__ . '/.env');

define('DB_HOST', getenv('DB_HOST') ?: 'localhost');
define('DB_USER', getenv('DB_USER') ?: 'root');
define('DB_PASS', getenv('DB_PASS') ?: '');
define('API_SECRET', getenv('API_SECRET') ?: '');
define('ALLOWED_ORIGIN', getenv('ALLOWED_ORIGIN') ?: '*');

// Departamento padrão, usado se ninguém mandar o parâmetro "dept" — assim
// nenhum link/chamada antiga (de antes dessa mudança) quebra.
define('DEFAULT_DEPARTMENT', 'programacao');

// Nome de cada banco de dados, um por departamento. Pra adicionar um
// departamento novo no futuro, só acrescenta uma linha aqui.
// Compatibilidade: se o .env só tiver "DB_NAME" (formato antigo, de antes
// de existir múltiplos departamentos), usa esse valor pro banco de
// Programação — assim não quebra nada enquanto o .env não for atualizado.
$GLOBALS['DEPARTMENT_DATABASES'] = [
    'programacao' => getenv('DB_NAME_PROGRAMACAO') ?: (getenv('DB_NAME') ?: 'mse_board'),
    'planejamento' => getenv('DB_NAME_PLANEJAMENTO') ?: 'mse_board_planejamento',
];

// Descobre qual departamento foi pedido nessa chamada — sempre pela query
// string (?dept=x). Importante: NÃO lemos o corpo da requisição aqui, já
// que cada endpoint só pode ler o corpo (php://input) uma vez — se a gente
// lesse aqui também, o endpoint receberia um corpo vazio depois.
function getCurrentDepartment() {
    $dept = $_GET['dept'] ?? DEFAULT_DEPARTMENT;

    // Só aceita departamentos conhecidos — evita alguém tentar mandar um
    // nome de banco arbitrário pelo parâmetro.
    if (!isset($GLOBALS['DEPARTMENT_DATABASES'][$dept])) {
        $dept = DEFAULT_DEPARTMENT;
    }

    return $dept;
}

function getDbConnection() {
    static $connections = [];

    $dept = getCurrentDepartment();

    if (!isset($connections[$dept])) {
        $dbName = $GLOBALS['DEPARTMENT_DATABASES'][$dept];
        $dsn = "mysql:host=" . DB_HOST . ";dbname=" . $dbName . ";charset=utf8mb4";
        $connections[$dept] = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
    }

    return $connections[$dept];
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
