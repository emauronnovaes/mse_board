-- ==========================================
-- MSE Board — Separar departamentos DENTRO do mesmo banco de dados
-- Rode isso no banco que já existe (mse_board), sem precisar criar nada novo.
-- ==========================================

USE mse_board;

-- Adiciona a coluna "department" nas 3 tabelas — tudo que já existe hoje
-- vira automaticamente "programacao" (não perde nem mistura nada).
ALTER TABLE people ADD COLUMN department VARCHAR(50) NOT NULL DEFAULT 'programacao' AFTER id;
ALTER TABLE cards ADD COLUMN department VARCHAR(50) NOT NULL DEFAULT 'programacao' AFTER id;

-- IMPORTANTE: troca a chave primária de "id" sozinho para "(department, id)".
-- Sem isso, um post-it/pessoa do Planejamento com o MESMO id de um da
-- Programação (ex: os dois criam "person_1", pois cada departamento conta
-- do zero) SOBRESCREVE o do outro departamento no primeiro
-- "ON DUPLICATE KEY UPDATE" (save_person.php / save_card.php).
-- Todo endpoint já filtra por "id AND department" nas consultas, então
-- essa troca não quebra nada que já existe.
ALTER TABLE people DROP PRIMARY KEY, ADD PRIMARY KEY (department, id);
ALTER TABLE cards DROP PRIMARY KEY, ADD PRIMARY KEY (department, id);

-- A tabela board_state hoje só tem uma linha fixa (id = 1). Agora cada
-- departamento tem sua própria linha, identificada pelo nome dele.
-- NÃO mexemos na PRIMARY KEY (id) nem tiramos o "id" — scripts antigos
-- (backup.php, migrate_to_tables.php, restore_backup.php, sso_login.php e
-- mse-board/save_state.php) ainda fazem "WHERE id = 1" direto, sem passar
-- department, e continuam funcionando (sempre leem/gravam a linha da
-- Programação, que fica com id = 1). Só adicionamos um índice único em
-- "department" pra permitir buscar por ele nos endpoints novos.
ALTER TABLE board_state ADD COLUMN department VARCHAR(50) NOT NULL DEFAULT 'programacao';
ALTER TABLE board_state ADD UNIQUE INDEX idx_board_state_department (department);

-- Deixa "id" AUTO_INCREMENT — o save_state.php cria a linha de um
-- departamento novo com "INSERT INTO board_state (department, data)",
-- sem informar id nenhum; sem isso, esse INSERT falharia
-- ("Field 'id' doesn't have a default value").
ALTER TABLE board_state MODIFY id INT NOT NULL AUTO_INCREMENT;

-- Cria a linha vazia pro Planejamento (o board.html?dept=planejamento já
-- consegue funcionar assim que essa linha existir).
INSERT IGNORE INTO board_state (department, data) VALUES ('planejamento', '{}');

-- Índices, pra deixar rápido filtrar por departamento
CREATE INDEX idx_people_department ON people (department);
CREATE INDEX idx_cards_department ON cards (department);
