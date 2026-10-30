<?php
// ==========================================
// MSE Board — POST: recebe um arquivo (em base64) e salva de verdade no servidor,
// devolvendo uma URL — em vez de guardar o arquivo inteiro dentro do banco.
// ==========================================

require_once __DIR__ . '/../config.php';

header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;
requireApiKey();

$raw = file_get_contents('php://input');

$p = json_decode($raw, true);
if (!$p || empty($p['filename']) || empty($p['dataUrl'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Faltam filename e dataUrl.']);
    exit;
}

// dataUrl vem tipo "data:image/png;base64,AAAA..." — separa o tipo dos dados
if (!preg_match('/^data:([a-zA-Z0-9\/\+\.\-]+);base64,(.+)$/', $p['dataUrl'], $matches)) {
    http_response_code(400);
    echo json_encode(['error' => 'dataUrl em formato inválido.']);
    exit;
}

$binaryData = base64_decode($matches[2]);
if ($binaryData === false) {
    http_response_code(400);
    echo json_encode(['error' => 'Não foi possível decodificar o arquivo.']);
    exit;
}

try {
    $uploadsDir = __DIR__ . '/../uploads';
    if (!is_dir($uploadsDir)) {
        mkdir($uploadsDir, 0755, true);
    }

    // Nome de arquivo seguro e único (evita sobrescrever e evita caracteres perigosos)
    $safeName = preg_replace('/[^a-zA-Z0-9._-]/', '_', basename($p['filename']));

    // Aceita qualquer tipo de arquivo (sql, zip, etc.), mas nada que o servidor
    // possa EXECUTAR ao ser aberto pela URL. Confere todos os pedaços do nome
    // (Apache executa "x.php.jpg" em algumas configurações) e, se achar um
    // tipo executável, troca os pontos por "_" e salva como .txt.
    // O nome original continua aparecendo no post-it.
    $executaveis = ['php', 'php3', 'php4', 'php5', 'php7', 'php8', 'phtml', 'pht', 'phps', 'phar',
        'cgi', 'pl', 'py', 'asp', 'aspx', 'jsp', 'sh', 'shtml', 'htaccess', 'htpasswd', 'ini', 'user'];
    $pedacos = array_map('strtolower', array_slice(explode('.', $safeName), 1));
    if (array_intersect($pedacos, $executaveis)) {
        $safeName = str_replace('.', '_', $safeName) . '.txt';
    }

    $uniqueName = uniqid() . '_' . $safeName;
    $fullPath = $uploadsDir . '/' . $uniqueName;

    if (file_put_contents($fullPath, $binaryData) === false) {
        http_response_code(500);
        echo json_encode(['error' => 'Falha ao salvar o arquivo no servidor. Confira permissões da pasta uploads/.']);
        exit;
    }

    $scheme = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'];
    $publicUrl = "$scheme://$host/mse-backend/uploads/$uniqueName";

    echo json_encode(['success' => true, 'url' => $publicUrl]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Falha ao processar o upload.', 'details' => $e->getMessage()]);
}
