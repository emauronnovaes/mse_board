<?php
// ==========================================
// MSE Board — POST: restaura um post-it excluído (do histórico ou de backup)
// Corpo: { source: "historico"|"backup", historyId?, file?, cardId, personId? }
// ==========================================

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../deleted_cards_helper.php';

header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;
requireApiKey();

$p = json_decode(file_get_contents('php://input'), true);
if (!$p || empty($p['cardId']) || empty($p['source'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Faltam cardId e source.']);
    exit;
}

try {
    $pdo = getDbConnection();
    $dept = getCurrentDepartment();
    ensureDeletedCardsTable($pdo);

    $row = null;
    $historyId = null;

    if ($p['source'] === 'historico') {
        $s = $pdo->prepare("SELECT id, row_data FROM cards_deleted WHERE id = :id AND card_id = :card AND department = :dept AND restored_at IS NULL");
        $s->execute(['id' => (int) ($p['historyId'] ?? 0), 'card' => $p['cardId'], 'dept' => $dept]);
        $h = $s->fetch(PDO::FETCH_ASSOC);
        if ($h) { $row = json_decode($h['row_data'], true); $historyId = (int) $h['id']; }
    } elseif ($p['source'] === 'backup') {
        $file = basename($p['file'] ?? '');
        if (!preg_match('/^backup_[0-9_\-]+\.json$/', $file)) {
            http_response_code(400);
            echo json_encode(['error' => 'Arquivo de backup inválido.']);
            exit;
        }
        $path = __DIR__ . '/../backups/' . $file;
        $json = is_file($path) ? json_decode(file_get_contents($path), true) : null;
        foreach (($json['cards'] ?? []) as $c) {
            if (($c['id'] ?? null) === $p['cardId'] && ($c['department'] ?? $dept) === $dept) { $row = $c; break; }
        }
    }

    if (!$row || empty($row['id'])) {
        http_response_code(404);
        echo json_encode(['error' => 'Post-it não encontrado no histórico.']);
        exit;
    }

    $fallback = !empty($p['personId']) ? $p['personId'] : defaultPersonIdForRestore($pdo, $dept);
    if (!$fallback) {
        http_response_code(409);
        echo json_encode(['error' => 'Não há nenhuma coluna pra receber o post-it.']);
        exit;
    }

    $pdo->beginTransaction();
    $exists = $pdo->prepare("SELECT COUNT(*) FROM cards WHERE id = :id");
    $exists->execute(['id' => $row['id']]);
    if ($exists->fetchColumn()) {
        $pdo->rollBack();
        http_response_code(409);
        echo json_encode(['error' => 'Esse post-it já está no quadro.']);
        exit;
    }

    insertCardFromRow($pdo, $row, $dept, $fallback);
    if ($historyId) {
        $pdo->prepare("UPDATE cards_deleted SET restored_at = :at WHERE id = :id")
            ->execute(['at' => (int) round(microtime(true) * 1000), 'id' => $historyId]);
    }
    $pdo->commit();

    echo json_encode(['success' => true]);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    http_response_code(500);
    echo json_encode(['error' => 'Falha ao restaurar o post-it.', 'details' => $e->getMessage()]);
}
