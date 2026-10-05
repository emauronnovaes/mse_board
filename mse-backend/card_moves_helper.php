<?php
// ==========================================
// MSE Board — Log de movimentação dos post-its
//
// Toda vez que um post-it muda de coluna (pessoa) ou de raia (status), fica
// gravada uma linha em `card_moves`: de onde saiu, pra onde foi e quando.
// É isso que permite saber em que dia uma tarefa entrou em "Fazendo",
// "Concluída" etc. sem depender da data de término preenchida à mão.
//
// A tabela é criada sozinha na primeira vez (CREATE TABLE IF NOT EXISTS),
// então não precisa rodar nada no phpMyAdmin — o schema_v8.sql existe só
// como registro/alternativa.
// ==========================================

function ensureCardMovesTable(PDO $pdo) {
    static $ok = false;
    if ($ok) return;

    // Atenção: CREATE TABLE faz commit implícito no MySQL — por isso esta
    // função tem que ser chamada ANTES de abrir qualquer transação.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS card_moves (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            card_id VARCHAR(64) NOT NULL,
            department VARCHAR(50) NOT NULL,
            from_person_id VARCHAR(64) NULL,
            from_status VARCHAR(20) NULL,
            to_person_id VARCHAR(64) NOT NULL,
            to_status VARCHAR(20) NOT NULL,
            moved_by VARCHAR(255) NULL,
            moved_at BIGINT NOT NULL,
            INDEX idx_card (card_id, moved_at),
            INDEX idx_dept_moved (department, moved_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
    $ok = true;
}

// Lê a posição atual do post-it travando a linha (FOR UPDATE). O quadro
// dispara move_card.php e save_card.php quase ao mesmo tempo no arrastar;
// com a trava, o segundo espera o primeiro terminar e já enxerga a posição
// nova — assim a mesma movimentação não é gravada duas vezes no log.
// Devolve null se o post-it ainda não existe (é um post-it novo).
function lockCardPosition(PDO $pdo, $cardId, $dept) {
    $stmt = $pdo->prepare("SELECT person_id, status FROM cards WHERE id = :id AND department = :dept FOR UPDATE");
    $stmt->execute(['id' => $cardId, 'dept' => $dept]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

// Grava no log só se a coluna ou a raia mudou de verdade (reordenar dentro
// da mesma raia não conta como movimentação).
function logCardMoveIfChanged(PDO $pdo, $cardId, $dept, $before, $toPersonId, $toStatus, $movedBy = null) {
    if (!$before) return;
    $fromPerson = $before['person_id'];
    $fromStatus = $before['status'] ?: 'todo';
    $toStatus = $toStatus ?: 'todo';
    if ($fromPerson === $toPersonId && $fromStatus === $toStatus) return;

    $stmt = $pdo->prepare(
        "INSERT INTO card_moves (card_id, department, from_person_id, from_status, to_person_id, to_status, moved_by, moved_at)
         VALUES (:card_id, :dept, :from_person, :from_status, :to_person, :to_status, :moved_by, :moved_at)"
    );
    $stmt->execute([
        'card_id' => $cardId,
        'dept' => $dept,
        'from_person' => $fromPerson,
        'from_status' => $fromStatus,
        'to_person' => $toPersonId,
        'to_status' => $toStatus,
        'moved_by' => $movedBy ? substr((string) $movedBy, 0, 255) : null,
        'moved_at' => (int) round(microtime(true) * 1000)
    ]);
}
