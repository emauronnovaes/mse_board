-- ==========================================
-- MSE Board — Planejamento — Banco de dados separado
-- Rode isso tudo de uma vez no HeidiSQL (Consulta em branco, cola tudo, executa)
-- ==========================================

-- Se quiser um nome diferente de "mse_board_planejamento", troca aqui E em todo
-- lugar mais abaixo (Ctrl+H no HeidiSQL pra substituir de uma vez).
CREATE DATABASE IF NOT EXISTS mse_board_planejamento CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE mse_board_planejamento;

-- ---------- Tabela: pessoas/colunas do quadro ----------
CREATE TABLE IF NOT EXISTS people (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    avatar_url TEXT NULL,
    is_done TINYINT(1) NOT NULL DEFAULT 0,
    member_email VARCHAR(255) NULL,
    position INT NOT NULL DEFAULT 0
);

-- ---------- Tabela: post-its/tarefas ----------
CREATE TABLE IF NOT EXISTS cards (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    person_id VARCHAR(64) NOT NULL,
    title VARCHAR(500) NOT NULL,
    color VARCHAR(20) NOT NULL DEFAULT 'yellow',
    priority VARCHAR(20) NOT NULL DEFAULT 'media',
    due_date VARCHAR(20) NULL,
    start_date VARCHAR(20) NULL,
    observacao TEXT NULL,
    estimated_hours FLOAT NULL,
    worked_hours FLOAT NULL,
    project VARCHAR(255) NULL,
    author VARCHAR(255) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'todo',
    position DOUBLE NULL,
    sticker_id VARCHAR(50) NULL,
    cover_image LONGTEXT NULL,
    starred TINYINT(1) NOT NULL DEFAULT 0,
    archived TINYINT(1) NOT NULL DEFAULT 0,
    checklist JSON NULL,
    attachments JSON NULL,
    comments JSON NULL,
    assignees JSON NULL,
    label_ids JSON NULL,
    custom_values JSON NULL,
    created_at BIGINT NULL,
    completed_at BIGINT NULL,
    manual_progress INT NULL,
    hidden_from_dashboard TINYINT(1) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_person (person_id)
);

-- ---------- Tabela: estado geral do quadro (membros, etiquetas, config) ----------
CREATE TABLE IF NOT EXISTS board_state (
    id INT NOT NULL PRIMARY KEY,
    data LONGTEXT NULL
);

-- Garante que já existe a linha 1 (o site espera ela existir)
INSERT IGNORE INTO board_state (id, data) VALUES (1, '{}');
