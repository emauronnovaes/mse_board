<?php
// ==========================================
// MSE Board — GET: lista todas as pessoas/colunas
// ==========================================

ini_set('display_errors', '0'); // nunca deixa o PHP imprimir erro em HTML no meio do JSON
error_reporting(E_ALL);

require_once __DIR__ . '/../config.php';

header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;
requireApiKey();

try {
    $pdo = getDbConnection();
    $stmt = $pdo->query("SELECT * FROM people ORDER BY is_done ASC, position ASC");
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $people = array_map(function ($r) {
        return [
            'id' => $r['id'],
            'name' => $r['name'],
            'avatarUrl' => $r['avatar_url'],
            'isDone' => (bool) $r['is_done'],
            'memberEmail' => $r['member_email']
        ];
    }, $rows);

    echo json_encode($people);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'error' => 'Erro ao buscar pessoas.',
        'details' => $e->getMessage()
    ]);
}
