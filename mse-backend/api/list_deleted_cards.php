<?php
// ==========================================
// MSE Board — GET: histórico de post-its excluídos
//
// Duas origens:
//  - "historico": guardados em cards_deleted no momento da exclusão
//  - "backup": achados nos arquivos de backups/ e que não existem mais
//    (cobre o que foi apagado ANTES do histórico existir)
//
// Filtros (query string): q (texto no título), de / ate (AAAA-MM-DD, pela
// data da exclusão — ou do backup, quando vem de backup).
// ==========================================

ini_set('display_errors', '0');
error_reporting(E_ALL);

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../deleted_cards_helper.php';

header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;
requireApiKey();

function resumoDoCard(array $r) {
    return [
        'cardId' => $r['id'],
        'title' => $r['title'] ?? '',
        'personId' => $r['person_id'] ?? null,
        'priority' => $r['priority'] ?? null,
        'status' => $r['status'] ?? null,
        'dueDate' => $r['due_date'] ?? null,
    ];
}

try {
    $pdo = getDbConnection();
    $dept = getCurrentDepartment();
    ensureDeletedCardsTable($pdo);

    $q = trim($_GET['q'] ?? '');
    $de = !empty($_GET['de']) ? strtotime($_GET['de'] . ' 00:00:00') * 1000 : null;
    $ate = !empty($_GET['ate']) ? (strtotime($_GET['ate'] . ' 23:59:59') + 1) * 1000 : null;

    $items = [];

    // --- Histórico (tabela) ---
    $stmt = $pdo->prepare(
        "SELECT id, card_id, title, person_id, reason, deleted_by, deleted_at, row_data
         FROM cards_deleted WHERE department = :dept AND restored_at IS NULL
         ORDER BY deleted_at DESC LIMIT 2000"
    );
    $stmt->execute(['dept' => $dept]);
    $idsNoHistorico = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $h) {
        $idsNoHistorico[$h['card_id']] = true;
        $row = json_decode($h['row_data'], true) ?: [];
        $row['id'] = $h['card_id'];
        $item = resumoDoCard($row);
        $item['title'] = $h['title'] ?? $item['title'];
        $item['source'] = 'historico';
        $item['historyId'] = (int) $h['id'];
        $item['deletedAt'] = (int) $h['deleted_at'];
        $item['deletedBy'] = $h['deleted_by'];
        $item['reason'] = $h['reason'];
        $items[] = $item;
    }

    // --- Backups (o que foi apagado antes do histórico existir) ---
    $atuais = [];
    $s = $pdo->prepare("SELECT id FROM cards WHERE department = :dept");
    $s->execute(['dept' => $dept]);
    foreach ($s->fetchAll(PDO::FETCH_COLUMN) as $id) $atuais[$id] = true;

    $porBackup = [];
    $arquivos = glob(__DIR__ . '/../backups/backup_*.json') ?: [];
    rsort($arquivos); // mais recente primeiro: guarda a versão mais nova de cada post-it
    foreach ($arquivos as $path) {
        $json = json_decode(@file_get_contents($path), true);
        if (!$json || empty($json['cards'])) continue;
        foreach ($json['cards'] as $c) {
            if (($c['department'] ?? $dept) !== $dept) continue;
            $id = $c['id'] ?? null;
            if (!$id || isset($atuais[$id]) || isset($idsNoHistorico[$id]) || isset($porBackup[$id])) continue;
            $item = resumoDoCard($c);
            $item['source'] = 'backup';
            $item['file'] = basename($path);
            $item['deletedAt'] = filemtime($path) * 1000; // "ainda existia nesta data"
            $item['deletedBy'] = null;
            $item['reason'] = 'Encontrado em backup (apagado antes do histórico)';
            $porBackup[$id] = $item;
        }
    }
    foreach ($porBackup as $item) $items[] = $item;

    // --- Filtros ---
    $items = array_values(array_filter($items, function ($i) use ($q, $de, $ate) {
        if ($q !== '' && mb_stripos($i['title'] ?? '', $q) === false) return false;
        if ($de !== null && $i['deletedAt'] < $de) return false;
        if ($ate !== null && $i['deletedAt'] >= $ate) return false;
        return true;
    }));
    usort($items, function ($a, $b) { return $b['deletedAt'] <=> $a['deletedAt']; });

    echo json_encode(array_slice($items, 0, 500), JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Erro ao buscar o histórico de excluídos.', 'details' => $e->getMessage()]);
}
