<?php
// ==========================================
// MSE Board — Histórico de post-its excluídos
//
// Toda vez que um post-it é apagado do banco (delete_card.php ou ao excluir
// uma coluna), a linha INTEIRA dele é guardada em `cards_deleted` antes do
// DELETE. Diferente da Lixeira antiga (que vivia dentro do blob do quadro e
// se perdia junto com ele), isto é uma tabela própria e nunca é limpa.
//
// A tabela é criada sozinha (CREATE TABLE IF NOT EXISTS). O schema_v9.sql
// existe só como registro.
// ==========================================

function ensureDeletedCardsTable(PDO $pdo) {
    static $ok = false;
    if ($ok) return;

    // CREATE TABLE faz commit implícito: chamar ANTES de abrir transação.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS cards_deleted (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            card_id VARCHAR(64) NOT NULL,
            department VARCHAR(50) NOT NULL,
            title VARCHAR(500) NULL,
            person_id VARCHAR(64) NULL,
            reason VARCHAR(255) NULL,
            deleted_by VARCHAR(255) NULL,
            deleted_at BIGINT NOT NULL,
            restored_at BIGINT NULL,
            row_data LONGTEXT NOT NULL,
            INDEX idx_dept_deleted (department, deleted_at),
            INDEX idx_card (card_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
    $ok = true;
}

// Guarda uma cópia da linha (como veio de SELECT * FROM cards).
function archiveDeletedCardRow(PDO $pdo, array $row, $dept, $reason = null, $deletedBy = null) {
    $stmt = $pdo->prepare(
        "INSERT INTO cards_deleted (card_id, department, title, person_id, reason, deleted_by, deleted_at, row_data)
         VALUES (:card_id, :dept, :title, :person_id, :reason, :by, :at, :data)"
    );
    $stmt->execute([
        'card_id' => $row['id'],
        'dept' => $dept,
        'title' => $row['title'] ?? null,
        'person_id' => $row['person_id'] ?? null,
        'reason' => $reason ? substr((string) $reason, 0, 255) : null,
        'by' => $deletedBy ? substr((string) $deletedBy, 0, 255) : null,
        'at' => (int) round(microtime(true) * 1000),
        'data' => json_encode($row, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE)
    ]);
}

// Recoloca uma linha guardada na tabela cards. Só usa colunas que existem
// de verdade hoje (o banco muda com o tempo). Se a coluna de origem não
// existe mais, cai na coluna $fallbackPersonId.
function insertCardFromRow(PDO $pdo, array $row, $dept, $fallbackPersonId) {
    $existing = array_column($pdo->query("SHOW COLUMNS FROM cards")->fetchAll(PDO::FETCH_ASSOC), 'Field');

    $p = $pdo->prepare("SELECT COUNT(*) FROM people WHERE id = :id AND department = :dept");
    $p->execute(['id' => $row['person_id'] ?? '', 'dept' => $dept]);
    if (!$p->fetchColumn()) $row['person_id'] = $fallbackPersonId;

    $row['department'] = $dept;
    $row['archived'] = 0;
    unset($row['updated_at']);

    $fields = [];
    foreach ($row as $col => $val) {
        if (in_array($col, $existing, true)) $fields[$col] = $val;
    }
    $cols = array_keys($fields);
    $sql = "INSERT INTO cards (" . implode(', ', $cols) . ") VALUES (" .
        implode(', ', array_map(function ($c) { return ':' . $c; }, $cols)) . ")";
    $pdo->prepare($sql)->execute($fields);
}

// Primeira coluna de pessoa (não é aba de "Concluído") do departamento.
function defaultPersonIdForRestore(PDO $pdo, $dept) {
    $s = $pdo->prepare("SELECT id FROM people WHERE department = :dept AND is_done = 0 ORDER BY id LIMIT 1");
    try {
        $s->execute(['dept' => $dept]);
        $id = $s->fetchColumn();
    } catch (Throwable $e) {
        $id = false;
    }
    if (!$id) {
        $s = $pdo->prepare("SELECT id FROM people WHERE department = :dept LIMIT 1");
        $s->execute(['dept' => $dept]);
        $id = $s->fetchColumn();
    }
    return $id ?: null;
}
