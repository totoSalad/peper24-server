'use strict';

module.exports = {
  async up(driver) {
    await driver.query(`
      CREATE TABLE conversations (
        id CHAR(26) CHARACTER SET ascii NOT NULL,
        user_id CHAR(26) CHARACTER SET ascii NOT NULL,
        topic VARCHAR(120) NOT NULL,
        scene VARCHAR(80) NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        memory_dirty_at DATETIME(3) NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        KEY idx_conversations_user_updated (user_id, updated_at),
        CONSTRAINT fk_conversations_user_id
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await driver.query(`
      CREATE TABLE messages (
        id CHAR(26) CHARACTER SET ascii NOT NULL,
        conversation_id CHAR(26) CHARACTER SET ascii NOT NULL,
        reply_to_message_id CHAR(26) CHARACTER SET ascii NULL,
        role VARCHAR(20) CHARACTER SET ascii NOT NULL,
        status VARCHAR(20) CHARACTER SET ascii NOT NULL,
        content TEXT NOT NULL,
        translation TEXT NULL,
        correction_json TEXT NULL,
        client_request_id VARCHAR(128) CHARACTER SET ascii NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_messages_conversation_request (conversation_id, client_request_id),
        KEY idx_messages_conversation_created (conversation_id, created_at),
        KEY idx_messages_reply (reply_to_message_id),
        CONSTRAINT fk_messages_conversation_id
          FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
        CONSTRAINT fk_messages_reply_to_message_id
          FOREIGN KEY (reply_to_message_id) REFERENCES messages (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  },

  async down(driver) {
    await driver.dropTable('messages');
    await driver.dropTable('conversations');
  },
};
