<?php
// ==========================================
// MSE Board — POST: exclui uma pessoa/coluna
// ==========================================

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../deleted_cards_helper.php';

header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;
requireApiKey();

$raw = file_get_contents('php://input');
$p = json_decode($raw, true);

if (!$p || empty($p['id'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Falta o id da pessoa.']);
    exit;
}

$pdo = getDbConnection();
$dept = getCurrentDepartment();

try {
    ensureDeletedCardsTable($pdo);
    $pdo->beginTransaction();

    // Guarda no histórico os post-its que ainda estiverem na coluna (o site
    // costuma apagar um a um antes; aqui pega o que sobrou).
    $sel = $pdo->prepare("SELECT * FROM cards WHERE person_id = :id AND department = :dept FOR UPDATE");
    $sel->execute(['id' => $p['id'], 'dept' => $dept]);
    foreach ($sel->fetchAll(PDO::FETCH_ASSOC) as $row) {
        archiveDeletedCardRow($pdo, $row, $dept, 'Coluna excluída', $p['deletedBy'] ?? null);
    }

    // Exclui também os post-its dessa pessoa
    $del1 = $pdo->prepare("DELETE FROM cards WHERE person_id = :id AND department = :dept");
    $del1->execute(['id' => $p['id'], 'dept' => $dept]);

    $del2 = $pdo->prepare("DELETE FROM people WHERE id = :id AND department = :dept");
    $del2->execute(['id' => $p['id'], 'dept' => $dept]);
    $pdo->commit();

    echo json_encode(['success' => true]);
} catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    http_response_code(500);
    echo json_encode(['error' => 'Falha ao excluir a pessoa/coluna.', 'details' => $e->getMessage()]);
}
