-- ==========================================
-- MSE Board — Adiciona a coluna que guarda QUANDO cada post-it foi concluído
-- Rode isso no phpMyAdmin (mse_board → aba SQL)
-- ==========================================

USE mse_board;

ALTER TABLE cards ADD COLUMN IF NOT EXISTS completed_at BIGINT NULL AFTER created_at;
