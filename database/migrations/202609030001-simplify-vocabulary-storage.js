'use strict';

module.exports = {
  async up(driver) {
    await driver.dropTable('vocabulary_contexts');
    await driver.query(`
      ALTER TABLE vocabularies
      DROP COLUMN original_expression
    `);
  },

  async down(driver) {
    await driver.query(`
      ALTER TABLE vocabularies
      ADD COLUMN original_expression VARCHAR(200) NULL AFTER user_id
    `);
    await driver.query(`
      UPDATE vocabularies
      SET original_expression = expression
      WHERE original_expression IS NULL
    `);
    await driver.query(`
      ALTER TABLE vocabularies
      MODIFY COLUMN original_expression VARCHAR(200) NOT NULL
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
        CONSTRAINT fk_vocabulary_context_vocabulary
          FOREIGN KEY (vocabulary_id) REFERENCES vocabularies (id) ON DELETE CASCADE,
        CONSTRAINT fk_vocabulary_context_message
          FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  },
};
