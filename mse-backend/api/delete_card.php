<?php
// ==========================================
// MSE Board — POST: exclui um post-it
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
$c = json_decode($raw, true);

if (!$c || empty($c['id'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Falta o id do post-it.']);
    exit;
}

$pdo = getDbConnection();
$dept = getCurrentDepartment();

try {
    ensureDeletedCardsTable($pdo);
    $pdo->beginTransaction();

    // Guarda a linha inteira no histórico ANTES de apagar — se a cópia
    // falhar, o post-it não é apagado (cai no catch e faz rollback).
    $sel = $pdo->prepare("SELECT * FROM cards WHERE id = :id AND department = :dept FOR UPDATE");
    $sel->execute(['id' => $c['id'], 'dept' => $dept]);
    $row = $sel->fetch(PDO::FETCH_ASSOC);
    if ($row) {
        archiveDeletedCardRow($pdo, $row, $dept, $c['reason'] ?? 'Excluído do quadro', $c['deletedBy'] ?? null);
    }

    $stmt = $pdo->prepare("DELETE FROM cards WHERE id = :id AND department = :dept");
    $stmt->execute(['id' => $c['id'], 'dept' => $dept]);
    $pdo->commit();
    echo json_encode(['success' => true]);
} catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    http_response_code(500);
    echo json_encode(['error' => 'Falha ao excluir o post-it.', 'details' => $e->getMessage()]);
}
