'use strict';

module.exports = {
  async up(driver) {
    await driver.query(`
      CREATE TABLE ai_usage_logs (
        message_id CHAR(26) CHARACTER SET ascii NOT NULL,
        user_id CHAR(26) CHARACTER SET ascii NOT NULL,
        conversation_id CHAR(26) CHARACTER SET ascii NOT NULL,
        task VARCHAR(50) CHARACTER SET ascii NOT NULL,
        provider VARCHAR(50) CHARACTER SET ascii NOT NULL,
        model VARCHAR(100) CHARACTER SET ascii NOT NULL,
        input_tokens INT UNSIGNED NOT NULL DEFAULT 0,
        output_tokens INT UNSIGNED NOT NULL DEFAULT 0,
        status VARCHAR(20) CHARACTER SET ascii NOT NULL,
        created_at DATETIME(3) NOT NULL,
        PRIMARY KEY (message_id),
        KEY idx_ai_usage_user_created (user_id, created_at),
        KEY idx_ai_usage_conversation_created (conversation_id, created_at),
        CONSTRAINT fk_ai_usage_message_id
          FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE,
        CONSTRAINT fk_ai_usage_user_id
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_ai_usage_conversation_id
          FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  },

  async down(driver) {
    await driver.dropTable('ai_usage_logs');
  },
};
