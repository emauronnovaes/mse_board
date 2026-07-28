<?php
// ==========================================
// MSE Board — Migra pessoas e post-its do JSON antigo pras tabelas novas
// Rode isso UMA VEZ no navegador: http://localhost/mse-backend/api/migrate_to_tables.php
// É seguro rodar mais de uma vez — ele pula quem já foi migrado.
// ==========================================

require_once __DIR__ . '/../config.php';

header('Content-Type: application/json; charset=utf-8');
requireApiKey();

$pdo = getDbConnection();

$stmt = $pdo->query("SELECT data FROM board_state WHERE id = 1");
$row = $stmt->fetch(PDO::FETCH_ASSOC);
$blob = $row && $row['data'] ? json_decode($row['data'], true) : [];

$peopleMigrated = 0;
$cardsMigrated = 0;

if (!empty($blob['people'])) {
    $insertPerson = $pdo->prepare(
        "INSERT IGNORE INTO people (id, name, avatar_url, is_done, member_email, position)
         VALUES (:id, :name, :avatar_url, :is_done, :member_email, :position)"
    );
    foreach ($blob['people'] as $i => $p) {
        $insertPerson->execute([
            'id' => $p['id'],
            'name' => $p['name'],
            'avatar_url' => $p['avatarUrl'] ?? null,
            'is_done' => !empty($p['isDone']) ? 1 : 0,
            'member_email' => $p['memberEmail'] ?? null,
            'position' => $i
        ]);
        if ($insertPerson->rowCount() > 0) $peopleMigrated++;
    }
}

if (!empty($blob['cards'])) {
    $insertCard = $pdo->prepare(
        "INSERT IGNORE INTO cards
         (id, person_id, title, color, priority, due_date, author, status, sticker_id, cover_image,
          starred, archived, checklist, attachments, comments, assignees, label_ids, custom_values, created_at)
         VALUES
         (:id, :person_id, :title, :color, :priority, :due_date, :author, :status, :sticker_id, :cover_image,
          :starred, :archived, :checklist, :attachments, :comments, :assignees, :label_ids, :custom_values, :created_at)"
    );
    foreach ($blob['cards'] as $c) {
        $insertCard->execute([
            'id' => $c['id'],
            'person_id' => $c['personId'],
            'title' => $c['title'],
            'color' => $c['color'] ?? 'yellow',
            'priority' => $c['priority'] ?? 'media',
            'due_date' => $c['dueDate'] ?? null,
            'author' => $c['author'] ?? null,
            'status' => $c['status'] ?? 'todo',
            'sticker_id' => $c['stickerId'] ?? null,
            'cover_image' => $c['coverImage'] ?? null,
            'starred' => !empty($c['starred']) ? 1 : 0,
            'archived' => !empty($c['archived']) ? 1 : 0,
            'checklist' => json_encode($c['checklist'] ?? []),
            'attachments' => json_encode($c['attachments'] ?? []),
            'comments' => json_encode($c['comments'] ?? []),
            'assignees' => json_encode($c['assignees'] ?? []),
            'label_ids' => json_encode($c['labelIds'] ?? []),
            'custom_values' => json_encode($c['customValues'] ?? (object)[]),
            'created_at' => $c['createdAt'] ?? null
        ]);
        if ($insertCard->rowCount() > 0) $cardsMigrated++;
    }
}

echo json_encode([
    'success' => true,
    'pessoas_migradas' => $peopleMigrated,
    'cards_migrados' => $cardsMigrated,
    'aviso' => 'Rode isso só uma vez. Post-its/pessoas já migrados são pulados automaticamente se rodar de novo.'
]);
