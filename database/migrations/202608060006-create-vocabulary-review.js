'use strict';

module.exports = {
  async up(driver) {
    await driver.query(`
      CREATE TABLE vocabularies (
        id CHAR(26) CHARACTER SET ascii NOT NULL,
        user_id CHAR(26) CHARACTER SET ascii NOT NULL,
        original_expression VARCHAR(200) NOT NULL,
        expression VARCHAR(200) NOT NULL,
        normalized_expression VARCHAR(200) NOT NULL,
        phonetic VARCHAR(200) NOT NULL,
        part_of_speech VARCHAR(80) NOT NULL,
        meaning VARCHAR(500) NOT NULL,
        example TEXT NOT NULL,
        last_encountered_at DATETIME(3) NOT NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_vocabularies_user_expression (user_id, normalized_expression),
        KEY idx_vocabularies_user_encountered (user_id, last_encountered_at),
        CONSTRAINT fk_vocabularies_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await driver.query(`
      CREATE TABLE vocabulary_contexts (
        id CHAR(26) CHARACTER SET ascii NOT NULL,
        vocabulary_id CHAR(26) CHARACTER SET ascii NOT NULL,
        message_id CHAR(26) CHARACTER SET ascii NOT NULL,
        sentence TEXT NOT NULL,
        created_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_vocabulary_context_message (vocabulary_id, message_id),
        CONSTRAINT fk_vocabulary_context_vocabulary FOREIGN KEY (vocabulary_id) REFERENCES vocabularies (id) ON DELETE CASCADE,
        CONSTRAINT fk_vocabulary_context_message FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await driver.query(`
      CREATE TABLE review_states (
        vocabulary_id CHAR(26) CHARACTER SET ascii NOT NULL,
        repetitions INT UNSIGNED NOT NULL DEFAULT 0,
        interval_days INT UNSIGNED NOT NULL DEFAULT 0,
        easiness_factor DECIMAL(6,4) NOT NULL DEFAULT 2.5000,
        next_review_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (vocabulary_id),
        KEY idx_review_states_due (next_review_at),
        CONSTRAINT fk_review_states_vocabulary FOREIGN KEY (vocabulary_id) REFERENCES vocabularies (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await driver.query(`
      CREATE TABLE review_logs (
        id CHAR(26) CHARACTER SET ascii NOT NULL,
        user_id CHAR(26) CHARACTER SET ascii NOT NULL,
        vocabulary_id CHAR(26) CHARACTER SET ascii NOT NULL,
        client_request_id VARCHAR(128) CHARACTER SET ascii NOT NULL,
        result VARCHAR(16) CHARACTER SET ascii NOT NULL,
        score TINYINT UNSIGNED NOT NULL,
        before_state_json TEXT NOT NULL,
        after_state_json TEXT NOT NULL,
        reviewed_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_review_logs_user_request (user_id, client_request_id),
        KEY idx_review_logs_vocabulary_reviewed (vocabulary_id, reviewed_at),
        CONSTRAINT fk_review_logs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_review_logs_vocabulary FOREIGN KEY (vocabulary_id) REFERENCES vocabularies (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  },

  async down(driver) {
    await driver.dropTable('review_logs');
    await driver.dropTable('review_states');
    await driver.dropTable('vocabulary_contexts');
    await driver.dropTable('vocabularies');
  },
};
