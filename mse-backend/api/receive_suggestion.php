<?php
// ==========================================
// MSE Board — Recebe sugestões de melhoria de fora (ex: GPT Maker)
// e cria um POST-IT DE VERDADE na coluna fixa "💡 Sugestões Mia" do quadro.
//
// Chame esta URL via POST (JSON) OU GET (parâmetro na URL), com o texto da sugestão.
// Protegida por um token PRÓPRIO (diferente da chave interna da API), configurável
// em config.php (SUGGESTIONS_WEBHOOK_TOKEN).
//
// Exemplos de uso:
//   POST /mse-backend/api/receive_suggestion.php?token=SEU_TOKEN
//   Corpo: {"text": "Resumo da melhoria sugerida", "author": "GPT Maker"}
//
//   OU, se a ferramenta só suportar GET:
//   /mse-backend/api/receive_suggestion.php?token=SEU_TOKEN&text=Resumo+da+melhoria
// ==========================================

ini_set('display_errors', '0');
require_once __DIR__ . '/../config.php';

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;

$providedToken = $_GET['token'] ?? $_POST['token'] ?? ($_SERVER['HTTP_X_SUGGESTION_TOKEN'] ?? '');
if (!hash_equals(SUGGESTIONS_WEBHOOK_TOKEN, $providedToken)) {
    http_response_code(401);
    echo json_encode(['error' => 'Token inválido ou ausente.']);
    exit;
}

$body = json_decode(file_get_contents('php://input'), true) ?? [];
$text = trim($body['text'] ?? $_POST['text'] ?? $_GET['text'] ?? '');
$author = $body['author'] ?? $_POST['author'] ?? $_GET['author'] ?? 'GPT Maker';

if ($text === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Falta o texto da sugestão (parâmetro "text").']);
    exit;
}

// Título do post-it: a própria sugestão (limitado ao tamanho da coluna no banco)
$title = mb_substr($text, 0, 490);

try {
    $pdo = getDbConnection();

    // Garante que a coluna fixa "Sugestões Mia" existe (caso o site nunca tenha carregado ainda)
    $check = $pdo->prepare("SELECT COUNT(*) FROM people WHERE id = 'suggestions'");
    $check->execute();
    if ($check->fetchColumn() == 0) {
        $insertPerson = $pdo->prepare(
            "INSERT INTO people (id, name, avatar_url, is_done, member_email, position) VALUES ('suggestions', '💡 Sugestões Mia', NULL, 0, NULL, 999)"
        );
        $insertPerson->execute();
    }

    $cardId = 'c_sug_' . round(microtime(true) * 1000);

    $insertCard = $pdo->prepare(
        "INSERT INTO cards
            (id, person_id, title, color, priority, due_date, author, status, sticker_id, cover_image,
             starred, archived, checklist, attachments, comments, assignees, label_ids, custom_values, created_at, completed_at)
         VALUES
            (:id, 'suggestions', :title, 'yellow', 'media', NULL, :author, 'todo', NULL, NULL,
             0, 0, '[]', '[]', '[]', '[]', '[]', '{}', :created_at, NULL)"
    );
    $insertCard->execute([
        'id' => $cardId,
        'title' => $title,
        'author' => $author,
        'created_at' => round(microtime(true) * 1000)
    ]);

    echo json_encode(['success' => true, 'mensagem' => 'Sugestão registrada como tarefa na coluna Sugestões Mia.', 'cardId' => $cardId]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Falha ao salvar a sugestão: ' . $e->getMessage()]);
}
