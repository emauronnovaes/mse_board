# Backup Automático Agendado — MSE Board

## O que já funciona sozinho
Toda vez que alguém clica em **"Backup no Servidor"** no menu lateral (só Admin vê essa opção
funcionando), o site gera um arquivo JSON com todo o conteúdo do banco (quadro, pessoas,
post-its) e salva na pasta `mse-backend/backups/`. Backups com mais de 30 dias são apagados
automaticamente, pra não acumular pra sempre.

Isso já é uma proteção manual. Mas se você quiser que aconteça **sozinho todo dia**, sem
precisar clicar em nada, siga o passo a passo abaixo.

---

## Passo a passo: agendar no Windows

1. Aperte a tecla Windows e digite **"Agendador de Tarefas"** (Task Scheduler), abra o programa.
2. Clique em **"Criar Tarefa Básica..."** (no painel da direita).
3. Nome: `MSE Board - Backup Diário`. Clique em Avançar.
4. Escolha **"Diariamente"**. Clique em Avançar.
5. Escolha o horário (sugestão: de madrugada, tipo 03:00, quando ninguém está usando o quadro).
   Clique em Avançar.
6. Em "Ação", escolha **"Iniciar um programa"**. Clique em Avançar.
7. Em "Programa/script", digite: `curl`
8. Em "Adicionar argumentos", cole isto (tudo numa linha só), trocando
   `SUA_API_SECRET` pelo valor de `API_SECRET` que está no arquivo `.env`:
   ```
   -H "X-API-Key: SUA_API_SECRET" http://localhost/mse_board/mse-backend/api/backup.php
   ```
9. Clique em Avançar, depois em **Concluir**.

Pronto — todo dia, no horário escolhido, o Windows vai chamar o backup sozinho, mesmo sem
ninguém logado no site.

---

## Onde ficam os backups
Em `htdocs/mse-backend/backups/`, um arquivo por dia, nomeado tipo
`backup_2026-07-27_030000.json`. Cada um contém uma cópia completa e legível de tudo.

## Como restaurar um backup (se precisar)
Isso ainda não tem botão automático — se um dia precisar restaurar, me chame que eu crio
um script específico pra importar de volta um desses arquivos JSON pro banco.

## Atenção
⚠️ O `curl` já vem instalado por padrão a partir do Windows 10. Se o comando não funcionar
no Passo 8, digite `curl` sozinho no Prompt de Comando pra testar se ele existe na sua máquina.
