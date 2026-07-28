<?php
// ==========================================
// MSE Board — Gera um backup completo (estado + pessoas + post-its)
// num arquivo JSON com data/hora, guardado na pasta backups/.
//
// Pode ser chamado manualmente pelo navegador, OU agendado (recomendado):
// use o Agendador de Tarefas do Windows pra rodar isso todo dia,
// chamando esta URL com curl. Veja instruções no LEIA-ME.
// ==========================================

require_once __DIR__ . '/../config.php';

header('Content-Type: application/json; charset=utf-8');
requireApiKey();

$pdo = getDbConnection();

$state = $pdo->query("SELECT data FROM board_state WHERE id = 1")->fetch(PDO::FETCH_ASSOC);
$people = $pdo->query("SELECT * FROM people")->fetchAll(PDO::FETCH_ASSOC);
$cards = $pdo->query("SELECT * FROM cards")->fetchAll(PDO::FETCH_ASSOC);

$backup = [
    'geradoEm' => date('Y-m-d H:i:s'),
    'boardState' => $state ? json_decode($state['data'], true) : null,
    'people' => $people,
    'cards' => $cards
];

$backupsDir = __DIR__ . '/../backups';
if (!is_dir($backupsDir)) {
    mkdir($backupsDir, 0755, true);
}

$filename = 'backup_' . date('Y-m-d_His') . '.json';
$fullPath = $backupsDir . '/' . $filename;
file_put_contents($fullPath, json_encode($backup, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

// Apaga backups com mais de 30 dias, pra não acumular pra sempre
foreach (glob($backupsDir . '/backup_*.json') as $oldFile) {
    if (filemtime($oldFile) < strtotime('-30 days')) {
        unlink($oldFile);
    }
}

echo json_encode([
    'success' => true,
    'arquivo' => $filename,
    'mensagem' => 'Backup criado com sucesso em backups/' . $filename
]);
