<?php
// ==========================================
// MSE Board — Config pública do frontend
// Lê o mesmo .env do backend e entrega ao navegador apenas o endereço da API.
// O API_SECRET NÃO vem mais pra cá: quem protege a API é a sessão do login
// (session_helper.php); a chave fica só pra rotinas do servidor (backup).
// Inclua ANTES do script.js:  <script src="config.js.php"></script>
// ==========================================

require_once __DIR__ . '/../mse-backend/config.php';

header('Content-Type: application/javascript; charset=utf-8');
// Não deixa cache guardar (garante que uma troca de chave no .env pegue na hora)
header('Cache-Control: no-store');
?>
window.APP_CONFIG = {
    API_BASE: <?= json_encode(API_BASE, JSON_UNESCAPED_SLASHES) ?>
};
