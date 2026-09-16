<?php
// ==========================================
// Diagnóstico temporário — mostra quantos post-its/pessoas existem por
// departamento no banco, e confirma se as colunas/filtros estão certos.
// Depois de resolver o problema, apague esse arquivo do servidor.
// ==========================================

require_once __DIR__ . '/../config.php';

header('Content-Type: application/json; charset=utf-8');

try {
    $pdo = getDbConnection();

    $colsCards = array_column($pdo->query("SHOW COLUMNS FROM cards")->fetchAll(PDO::FETCH_ASSOC), 'Field');
    $colsPeople = array_column($pdo->query("SHOW COLUMNS FROM people")->fetchAll(PDO::FETCH_ASSOC), 'Field');
    $colsBoardState = array_column($pdo->query("SHOW COLUMNS FROM board_state")->fetchAll(PDO::FETCH_ASSOC), 'Field');

    $cardsByDept = $pdo->query("SELECT department, COUNT(*) as total FROM cards GROUP BY department")->fetchAll(PDO::FETCH_ASSOC);
    $peopleByDept = $pdo->query("SELECT department, COUNT(*) as total FROM people GROUP BY department")->fetchAll(PDO::FETCH_ASSOC);
    $boardStateRows = $pdo->query("SELECT department FROM board_state")->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        'cards_tem_coluna_department' => in_array('department', $colsCards),
        'people_tem_coluna_department' => in_array('department', $colsPeople),
        'board_state_tem_coluna_department' => in_array('department', $colsBoardState),
        'cards_por_departamento' => $cardsByDept,
        'pessoas_por_departamento' => $peopleByDept,
        'linhas_board_state' => $boardStateRows,
        'config_tem_getCurrentDepartment' => function_exists('getCurrentDepartment'),
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    echo json_encode(['erro' => $e->getMessage()], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
}
