<?php
// ==========================================
// MSE Board — POST: cria ou atualiza uma pessoa/coluna
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

if (!$p || empty($p['id']) || empty($p['name'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Dados da pessoa incompletos (precisa de id e name).']);
    exit;
}

$pdo = getDbConnection();

try {
    // Trava a tabela pra calcular a posição, senão duas pessoas clicando em
    // "+ Adicionar Pessoa" ao mesmo tempo podem ler o mesmo "último lugar" e
    // as duas colunas nascerem empatadas na mesma posição — o que fazia a
    // ordem delas ficar instável, "pulando" de lugar a cada atualização.
    $pdo->beginTransaction();

    $maxPos = $pdo->query("SELECT COALESCE(MAX(position), -1) FROM people FOR UPDATE")->fetchColumn();

    $stmt = $pdo->prepare(
        "INSERT INTO people (id, name, avatar_url, is_done, member_email, position)
         VALUES (:id, :name, :avatar_url, :is_done, :member_email, :position)
         ON DUPLICATE KEY UPDATE
            name = VALUES(name),
            avatar_url = VALUES(avatar_url),
            is_done = VALUES(is_done),
            member_email = VALUES(member_email)"
    );

    $stmt->execute([
        'id' => $p['id'],
        'name' => $p['name'],
        'avatar_url' => $p['avatarUrl'] ?? null,
        'is_done' => !empty($p['isDone']) ? 1 : 0,
        'member_email' => $p['memberEmail'] ?? null,
        'position' => $maxPos + 1
    ]);

    $pdo->commit();

    echo json_encode(['success' => true]);
} catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    http_response_code(500);
    echo json_encode(['error' => 'Falha ao salvar a pessoa/coluna.', 'details' => $e->getMessage()]);
}
