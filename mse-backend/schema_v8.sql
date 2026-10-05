-- MSE Board — Log de movimentação dos post-its
-- Cada vez que um post-it muda de coluna (pessoa) ou de raia (status), grava
-- de onde saiu, pra onde foi e quando (moved_at em milissegundos, igual ao
-- created_at/completed_at da tabela cards).
-- Não precisa rodar à mão: card_moves_helper.php cria a tabela sozinho na
-- primeira chamada. Fica aqui como registro (ou se preferir criar antes).

USE mse_board;
CREATE TABLE IF NOT EXISTS card_moves (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    card_id VARCHAR(64) NOT NULL,
    department VARCHAR(50) NOT NULL,
    from_person_id VARCHAR(64) NULL,
    from_status VARCHAR(20) NULL,
    to_person_id VARCHAR(64) NOT NULL,
    to_status VARCHAR(20) NOT NULL,
    moved_by VARCHAR(255) NULL,
    moved_at BIGINT NOT NULL,
    INDEX idx_card (card_id, moved_at),
    INDEX idx_dept_moved (department, moved_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
