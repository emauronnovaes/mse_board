<?php
// ==========================================
// MSE Board — GET: retorna o estado atual do quadro
// ==========================================

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit;
}

require_once __DIR__ . '/../config.php';

$pdo = getDbConnection();
$stmt = $pdo->query("SELECT data FROM board_state WHERE id = 1");
$row = $stmt->fetch(PDO::FETCH_ASSOC);

if ($row && $row['data']) {
    // Já retorna o JSON puro (não precisa re-encodar, o banco já guarda JSON como texto)
    echo $row['data'];
} else {
    echo '{}';
}
