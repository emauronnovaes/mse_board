<?php
// ==========================================
// MSE Board — Teste rápido de conexão com o banco
// Acesse http://localhost/mse-backend/api/test_connection.php no navegador
// ==========================================

header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/../config.php';

$pdo = getDbConnection();
$stmt = $pdo->query("SELECT COUNT(*) as total FROM board_state");
$row = $stmt->fetch(PDO::FETCH_ASSOC);

echo json_encode([
    'success' => true,
    'message' => 'Conectado ao banco mse_board com sucesso!',
    'registros_na_tabela_board_state' => (int) $row['total']
]);
