'use strict';

module.exports = {
  async up(driver) {
    await driver.query(`
      CREATE TABLE grammar_error_patterns (
        id CHAR(26) CHARACTER SET ascii NOT NULL,
        user_id CHAR(26) CHARACTER SET ascii NOT NULL,
        error_type VARCHAR(50) CHARACTER SET ascii NOT NULL,
        occurrence_count INT UNSIGNED NOT NULL DEFAULT 0,
        corrected_at DATETIME(3) NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_grammar_patterns_user_type (user_id, error_type),
        CONSTRAINT fk_grammar_patterns_user_id
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await driver.query(`
      CREATE TABLE grammar_error_occurrences (
        id CHAR(26) CHARACTER SET ascii NOT NULL,
        pattern_id CHAR(26) CHARACTER SET ascii NOT NULL,
        user_message_id CHAR(26) CHARACTER SET ascii NOT NULL,
        details_json JSON NOT NULL,
        created_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_grammar_occurrences_pattern_message (pattern_id, user_message_id),
        KEY idx_grammar_occurrences_message (user_message_id),
        CONSTRAINT fk_grammar_occurrences_pattern_id
          FOREIGN KEY (pattern_id) REFERENCES grammar_error_patterns (id) ON DELETE CASCADE,
        CONSTRAINT fk_grammar_occurrences_message_id
          FOREIGN KEY (user_message_id) REFERENCES messages (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  },

  async down(driver) {
    await driver.dropTable('grammar_error_occurrences');
    await driver.dropTable('grammar_error_patterns');
  },
};
