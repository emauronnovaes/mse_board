<?php
// ==========================================
// MSE Board — POST: cria ou atualiza um post-it inteiro
//
// Esta versão descobre sozinha quais colunas existem de verdade na tabela
// `cards` antes de montar a query (usando SHOW COLUMNS). Isso evita o erro
// "Unknown column" quando o banco tem uma estrutura diferente da esperada
// (por exemplo, depois que "Obra/Projeto" e "Horas Estimadas/Trabalhadas"
// foram removidos e substituídos por "start_date"/"observacao").
//
// Também devolve a mensagem de erro real em caso de falha, em vez de uma
// tela em branco (erro 500 sem corpo) — facilita muito o diagnóstico.
// ==========================================

require_once __DIR__ . '/../config.php';

header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;
requireApiKey();

$raw = file_get_contents('php://input');

$c = json_decode($raw, true);

if (!$c || empty($c['id']) || empty($c['personId'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Dados do post-it incompletos (precisa de id e personId).']);
    exit;
}

try {
    $pdo = getDbConnection();

    // Descobre dinamicamente quais colunas existem de verdade na tabela `cards`
    // hoje. Assim, se o banco de produção tiver colunas diferentes das que o
    // código espera (renomeadas, removidas, adicionadas), a gente só usa as
    // que realmente existem, em vez de travar com "Unknown column".
    $existingColumns = array_column(
        $pdo->query("SHOW COLUMNS FROM cards")->fetchAll(PDO::FETCH_ASSOC),
        'Field'
    );

    // Candidatos: nome_da_coluna => valor a gravar. Cobre tanto os campos
    // antigos (project/estimated_hours/worked_hours) quanto os novos
    // (start_date/observacao) — só entra na query o que existir de verdade.
    $candidates = [
        'person_id'       => $c['personId'],
        'title'           => $c['title'],
        'color'           => $c['color'] ?? 'yellow',
        'priority'        => $c['priority'] ?? 'media',
        'due_date'        => $c['dueDate'] ?? null,
        'start_date'      => $c['startDate'] ?? null,
        'observacao'      => $c['observacao'] ?? '',
        'manual_progress' => array_key_exists('manualProgress', $c) ? $c['manualProgress'] : null,
        'hidden_from_dashboard' => !empty($c['hiddenFromDashboard']) ? 1 : 0,
        'estimated_hours' => $c['estimatedHours'] ?? null,
        'worked_hours'    => $c['workedHours'] ?? null,
        'project'         => $c['project'] ?? null,
        'author'          => $c['author'] ?? null,
        'status'          => $c['status'] ?? 'todo',
        'sticker_id'      => $c['stickerId'] ?? null,
        'cover_image'     => $c['coverImage'] ?? null,
        'starred'         => !empty($c['starred']) ? 1 : 0,
        'archived'        => !empty($c['archived']) ? 1 : 0,
        'checklist'       => json_encode($c['checklist'] ?? []),
        'attachments'     => json_encode($c['attachments'] ?? []),
        'comments'        => json_encode($c['comments'] ?? []),
        'assignees'       => json_encode($c['assignees'] ?? []),
        'label_ids'       => json_encode($c['labelIds'] ?? []),
        'custom_values'   => json_encode($c['customValues'] ?? (object)[]),
        'created_at'      => $c['createdAt'] ?? round(microtime(true) * 1000),
        'completed_at'    => $c['completedAt'] ?? null
    ];

    // id sempre entra (é a chave primária); os demais só se existirem na tabela
    $fields = ['id' => $c['id']];
    foreach ($candidates as $column => $value) {
        if (in_array($column, $existingColumns, true)) {
            $fields[$column] = $value;
        }
    }

    $columnNames = array_keys($fields);
    $placeholders = array_map(function ($col) {
        return ':' . $col;
    }, $columnNames);

    $updateColumns = array_filter($columnNames, function ($col) {
        return $col !== 'id';
    });
    $updateParts = array_map(function ($col) {
        return "$col = VALUES($col)";
    }, $updateColumns);

    $sql = "INSERT INTO cards (" . implode(', ', $columnNames) . ")
            VALUES (" . implode(', ', $placeholders) . ")
            ON DUPLICATE KEY UPDATE " . implode(', ', $updateParts);

    $stmt = $pdo->prepare($sql);
    $stmt->execute($fields);

    echo json_encode(['success' => true]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'error' => 'Falha ao salvar o post-it.',
        'details' => $e->getMessage()
    ]);
}
