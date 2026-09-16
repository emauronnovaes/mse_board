<?php
// ==========================================
// Diagnóstico temporário — confirma se o config.php novo (com suporte a
// múltiplos departamentos) está realmente em produção, e qual banco ele
// escolheria pra cada valor de ?dept=.
//
// Depois de resolver o problema, pode apagar esse arquivo do servidor.
// ==========================================

require_once __DIR__ . '/../config.php';

header('Content-Type: application/json; charset=utf-8');

$respostas = [];
foreach (['programacao', 'planejamento', 'valor_invalido_teste'] as $deptTeste) {
    $_GET['dept'] = $deptTeste;
    $respostas[$deptTeste] = [
        'departamento_detectado' => getCurrentDepartment(),
        'banco_que_seria_usado' => $GLOBALS['DEPARTMENT_DATABASES'][getCurrentDepartment()] ?? '???',
    ];
}

echo json_encode([
    'config_tem_suporte_a_departamentos' => function_exists('getCurrentDepartment'),
    'testes' => $respostas,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
