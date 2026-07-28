-- ==========================================
-- MSE Board — Novas colunas: horas e vínculo com obra/projeto
-- Rode isso no phpMyAdmin (mse_board → aba SQL)
-- ==========================================

USE mse_board;

ALTER TABLE cards ADD COLUMN estimated_hours FLOAT NULL AFTER due_date;
ALTER TABLE cards ADD COLUMN worked_hours FLOAT NULL AFTER estimated_hours;
ALTER TABLE cards ADD COLUMN project VARCHAR(255) NULL AFTER worked_hours;
