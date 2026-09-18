-- MSE Board — Adiciona a coluna "resumo" na tabela de post-its
-- É o texto livre que descreve do que se trata a tarefa, mostrado ao abrir o post-it.
-- Não confundir com "observacao", que é a anotação do Dashboard de Entregas.
-- Rode isso no phpMyAdmin do banco mse_board (uma vez só)

USE mse_board;
ALTER TABLE cards ADD COLUMN resumo TEXT NULL AFTER observacao;
