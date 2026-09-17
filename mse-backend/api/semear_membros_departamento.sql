-- ==========================================
-- MSE Board — Semeia os Admins num departamento NOVO
-- ==========================================
-- POR QUE ISSO EXISTE:
-- Cada departamento tem a SUA lista de membros, guardada no JSON da linha
-- dele em board_state. Um departamento recém-criado nasce com data = '{}',
-- ou seja, members vazio. E o board.html (script.js) faz:
--
--     const isInvited = !!state.members[userData.name];
--     if (!isInvited) { ...dashboard-only-mode...; return; }
--
-- Com members vazio NINGUÉM é convidado — todo mundo cai na tela só de
-- Dashboard, sem sidebar e sem quadro, e nem o Admin consegue entrar pra
-- cadastrar os membros. Este script quebra esse impasse copiando APENAS os
-- ADMINS do departamento de origem para o novo.
--
-- Só os Admins, de propósito: eles já enxergam tudo no sistema, então não
-- expõe o quadro novo a mais ninguém. Depois de entrar, o Admin cadastra o
-- time real do departamento pela tela "Membros e Permissões".
--
-- COMO USAR (HeidiSQL / phpMyAdmin — cola tudo e executa):
--   1. Ajuste @origem e @destino abaixo, se precisar.
--   2. Execute. O SELECT do final mostra como ficou.
-- Seguro rodar mais de uma vez: só acrescenta os Admins que faltam e nunca
-- mexe em quem já estava cadastrado no destino.
-- ==========================================

USE mse_board;

SET @origem  = 'programacao';
SET @destino = 'planejamento';

-- --- 1. Junta os ADMINS do departamento de origem ---
SET @admins = (
    SELECT JSON_OBJECTAGG(k.email, 'Admin')
    FROM board_state src
    JOIN JSON_TABLE(
             COALESCE(JSON_KEYS(src.data, '$.members'), JSON_ARRAY()),
             '$[*]' COLUMNS (email VARCHAR(255) PATH '$')
         ) k
    WHERE src.department = @origem
      AND JSON_UNQUOTE(JSON_EXTRACT(src.data, CONCAT('$.members."', k.email, '"'))) = 'Admin'
);

-- --- 2. Junta a senha desses mesmos Admins ---
-- Necessário porque o login.html valida a senha contra o userPasswords DO
-- departamento que está sendo aberto. Sem isso, o Admin só entraria por SSO.
SET @senhas = (
    SELECT JSON_OBJECTAGG(
               k.email,
               JSON_UNQUOTE(JSON_EXTRACT(src.data, CONCAT('$.userPasswords."', k.email, '"')))
           )
    FROM board_state src
    JOIN JSON_TABLE(
             COALESCE(JSON_KEYS(src.data, '$.members'), JSON_ARRAY()),
             '$[*]' COLUMNS (email VARCHAR(255) PATH '$')
         ) k
    WHERE src.department = @origem
      AND JSON_UNQUOTE(JSON_EXTRACT(src.data, CONCAT('$.members."', k.email, '"'))) = 'Admin'
      AND JSON_EXTRACT(src.data, CONCAT('$.userPasswords."', k.email, '"')) IS NOT NULL
);

-- Se a origem não tiver nenhum Admin, para por aqui em vez de gravar nulo.
SET @admins = COALESCE(@admins, JSON_OBJECT());
SET @senhas = COALESCE(@senhas, JSON_OBJECT());

-- --- 3. Garante que a linha do departamento destino existe ---
INSERT IGNORE INTO board_state (department, data) VALUES (@destino, '{}');

-- --- 4. Grava, sem sobrescrever quem já estava lá ---
-- JSON_MERGE_PATCH(oque_ja_tem, oque_estou_semeando) faria o semeado ganhar.
-- Invertendo a ordem, quem já estava cadastrado no destino é que prevalece.
-- O CAST(... AS JSON) é obrigatório: uma variável de usuário (@admins) chega
-- no JSON_OBJECT como TEXTO, e sem o cast o members seria gravado como uma
-- string JSON escapada ("{\"fulano\": \"Admin\"}") em vez de um objeto de
-- verdade — o script.js leria isso como um membro só, de nome estranho.
UPDATE board_state
SET data = JSON_MERGE_PATCH(
        JSON_OBJECT(
            'members',       CAST(@admins AS JSON),
            'userPasswords', CAST(@senhas AS JSON)
        ),
        COALESCE(NULLIF(data, ''), '{}')
    )
WHERE department = @destino;

-- --- 5. Conferência ---
SELECT
    department                              AS departamento,
    JSON_EXTRACT(data, '$.members')         AS membros,
    JSON_LENGTH(JSON_EXTRACT(data, '$.members')) AS qtd_membros
FROM board_state
WHERE department IN (@origem, @destino);
