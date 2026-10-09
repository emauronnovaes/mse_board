-- MSE Board — Rascunho de e-mail da tarefa (destinatário + texto)
-- Não precisa rodar à mão: save_card.php cria a coluna sozinho na primeira gravação.
USE mse_board;
ALTER TABLE cards ADD COLUMN email_draft TEXT NULL;
