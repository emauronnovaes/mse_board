-- ==========================================
-- MSE Board — Schema v2 (pessoas e post-its em tabelas de verdade)
-- Rode este arquivo no phpMyAdmin (aba "SQL") DEPOIS do schema.sql original.
-- Seguro rodar mais de uma vez (usa IF NOT EXISTS).
-- ==========================================

USE mse_board;

-- Colunas de pessoas (inclui as abas "Concluído")
CREATE TABLE IF NOT EXISTS people (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    avatar_url LONGTEXT NULL,
    is_done TINYINT(1) NOT NULL DEFAULT 0,
    member_email VARCHAR(255) NULL,
    position INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Post-its. Sub-listas (checklist, anexos, comentários, atribuídos, etiquetas,
-- campos personalizados) ficam como JSON dentro da própria linha — cada
-- post-it é uma linha independente, então editar post-its diferentes nunca
-- conflita entre pessoas diferentes.
CREATE TABLE IF NOT EXISTS cards (
    id VARCHAR(64) PRIMARY KEY,
    person_id VARCHAR(64) NOT NULL,
    title VARCHAR(500) NOT NULL,
    color VARCHAR(20) NOT NULL DEFAULT 'yellow',
    priority VARCHAR(20) NOT NULL DEFAULT 'media',
    due_date VARCHAR(20) NULL,
    author VARCHAR(255) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'todo',
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
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_person (person_id)
);
