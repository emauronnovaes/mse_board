<?php
// ==========================================
// MSE Board — GET: lista os backups já criados
// ==========================================

require_once __DIR__ . '/../config.php';

header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;
requireApiKey();

$backupsDir = __DIR__ . '/../backups';
$files = [];

if (is_dir($backupsDir)) {
    foreach (glob($backupsDir . '/backup_*.json') as $path) {
        $files[] = [
            'filename' => basename($path),
            'date' => date('d/m/Y H:i', filemtime($path)),
            'sizeKb' => round(filesize($path) / 1024, 1)
        ];
    }
}

usort($files, function ($a, $b) { return strcmp($b['filename'], $a['filename']); });

echo json_encode($files);
