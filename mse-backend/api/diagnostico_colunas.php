<?php
// ==========================================
// MSE Board — Diagnóstico (SÓ LEITURA, não altera nada)
// Mostra as colunas reais da tabela `cards` no banco.
// Apague este arquivo depois de usar.
// ==========================================

require_once __DIR__ . '/../config.php';

header('Content-Type: application/json; charset=utf-8');

try {
    $pdo = getDbConnection();
    $stmt = $pdo->query("DESCRIBE cards");
    $columns = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        'success' => true,
        'colunas_da_tabela_cards' => $columns
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    echo json_encode([
        'error' => 'Falha ao consultar a estrutura da tabela.',
        'details' => $e->getMessage()
    ]);
}
