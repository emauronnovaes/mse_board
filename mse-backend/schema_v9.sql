-- MSE Board — Histórico de post-its excluídos
-- Guarda a linha inteira de cada post-it apagado, pra poder restaurar depois.
-- Não precisa rodar à mão: deleted_cards_helper.php cria a tabela sozinho.

USE mse_board;
CREATE TABLE IF NOT EXISTS cards_deleted (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    card_id VARCHAR(64) NOT NULL,
    department VARCHAR(50) NOT NULL,
    title VARCHAR(500) NULL,
    person_id VARCHAR(64) NULL,
    reason VARCHAR(255) NULL,
    deleted_by VARCHAR(255) NULL,
    deleted_at BIGINT NOT NULL,
    restored_at BIGINT NULL,
    row_data LONGTEXT NOT NULL,
    INDEX idx_dept_deleted (department, deleted_at),
    INDEX idx_card (card_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
