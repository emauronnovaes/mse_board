-- MSE Board — Departamentos da tarefa (Reuniões e backlog)
-- Não precisa rodar à mão: save_card.php cria a coluna sozinho na primeira gravação.
USE mse_board;
ALTER TABLE cards ADD COLUMN departamentos TEXT NULL;
