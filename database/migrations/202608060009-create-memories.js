'use strict';

module.exports = {
  async up(driver) {
    await driver.query(`
      CREATE TABLE memories (
        id CHAR(26) CHARACTER SET ascii NOT NULL,
        user_id CHAR(26) CHARACTER SET ascii NOT NULL,
        type VARCHAR(32) CHARACTER SET ascii NOT NULL,
        content VARCHAR(500) NOT NULL,
        normalized_key VARCHAR(200) NOT NULL,
        confidence DECIMAL(5,4) NOT NULL,
        status VARCHAR(16) CHARACTER SET ascii NOT NULL DEFAULT 'active',
        expires_at DATETIME(3) NULL,
        deleted_at DATETIME(3) NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        KEY idx_memories_user_active (user_id, status, expires_at),
        KEY idx_memories_user_key (user_id, type, normalized_key),
        CONSTRAINT fk_memories_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await driver.query(`
      CREATE TABLE memory_sources (
        memory_id CHAR(26) CHARACTER SET ascii NOT NULL,
        message_id CHAR(26) CHARACTER SET ascii NOT NULL,
        created_at DATETIME(3) NOT NULL,
        PRIMARY KEY (memory_id, message_id),
        KEY idx_memory_sources_message (message_id),
        CONSTRAINT fk_memory_sources_memory FOREIGN KEY (memory_id) REFERENCES memories (id) ON DELETE CASCADE,
        CONSTRAINT fk_memory_sources_message FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await driver.query(`
      CREATE TABLE memory_change_logs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        memory_id CHAR(26) CHARACTER SET ascii NOT NULL,
        user_id CHAR(26) CHARACTER SET ascii NOT NULL,
        action VARCHAR(16) CHARACTER SET ascii NOT NULL,
        before_json TEXT NULL,
        after_json TEXT NULL,
        created_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        KEY idx_memory_changes_user_created (user_id, created_at),
        CONSTRAINT fk_memory_changes_memory FOREIGN KEY (memory_id) REFERENCES memories (id) ON DELETE CASCADE,
        CONSTRAINT fk_memory_changes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  },

  async down(driver) {
    await driver.dropTable('memory_change_logs');
    await driver.dropTable('memory_sources');
    await driver.dropTable('memories');
  },
};
