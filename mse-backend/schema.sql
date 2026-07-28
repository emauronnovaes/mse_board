-- ==========================================
-- MSE Board — Schema do banco de dados
-- Rode este arquivo no phpMyAdmin (aba "Importar" ou "SQL")
-- ==========================================

CREATE DATABASE IF NOT EXISTS mse_board
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE mse_board;

-- Guarda todo o estado do quadro (pessoas, post-its, membros, etc.)
-- num único registro JSON. Simples e suficiente para o volume de dados de um quadro.
CREATE TABLE IF NOT EXISTS board_state (
    id INT PRIMARY KEY,
    data LONGTEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Cria o único registro (id fixo = 1) que vai guardar o JSON do quadro
INSERT IGNORE INTO board_state (id, data) VALUES (1, '{}');
