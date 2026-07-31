-- MSE Board — Adiciona a coluna "start_date" (Data de Início) na tabela de post-its
-- Rode isso no phpMyAdmin do banco mse_board (uma vez só)

USE mse_board;
ALTER TABLE cards ADD COLUMN start_date DATE NULL AFTER due_date;
