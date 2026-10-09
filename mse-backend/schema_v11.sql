-- MSE Board — Aba de Reuniões (campos na tarefa)
-- Não precisa rodar à mão: save_card.php cria as colunas sozinho na primeira gravação.
USE mse_board;
ALTER TABLE cards ADD COLUMN reuniao TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE cards ADD COLUMN reuniao_status VARCHAR(20) NULL;
ALTER TABLE cards ADD COLUMN reuniao_num INT NULL;
