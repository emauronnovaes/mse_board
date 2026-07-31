-- MSE Board — Adiciona a coluna "observacao" na tabela de post-its
-- Rode isso no phpMyAdmin do banco mse_board (uma vez só)

USE mse_board;
ALTER TABLE cards ADD COLUMN observacao TEXT NULL AFTER completed_at;
