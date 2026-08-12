'use strict';

module.exports = {
  async up(driver) {
    await driver.query(`
      CREATE TABLE daily_learning_summaries (
        id CHAR(26) CHARACTER SET ascii NOT NULL,
        user_id CHAR(26) CHARACTER SET ascii NOT NULL,
        summary_date DATE NOT NULL,
        timezone VARCHAR(64) CHARACTER SET ascii NOT NULL,
        status VARCHAR(20) CHARACTER SET ascii NOT NULL,
        source_version CHAR(64) CHARACTER SET ascii NOT NULL,
        metrics_json JSON NOT NULL,
        content_json JSON NULL,
        provider VARCHAR(50) CHARACTER SET ascii NULL,
        model VARCHAR(100) CHARACTER SET ascii NULL,
        input_tokens INT UNSIGNED NOT NULL DEFAULT 0,
        output_tokens INT UNSIGNED NOT NULL DEFAULT 0,
        retry_count INT UNSIGNED NOT NULL DEFAULT 0,
        generated_at DATETIME(3) NULL,
        finalized_at DATETIME(3) NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_daily_learning_summary_user_date (user_id, summary_date),
        KEY idx_daily_learning_summary_user_date (user_id, summary_date DESC),
        KEY idx_daily_learning_summary_status_updated (status, updated_at),
        CONSTRAINT fk_daily_learning_summary_user
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await driver.query(`
      ALTER TABLE review_logs
      ADD KEY idx_review_logs_user_reviewed (user_id, reviewed_at)
    `);
  },

  async down(driver) {
    await driver.query('ALTER TABLE review_logs DROP INDEX idx_review_logs_user_reviewed');
    await driver.dropTable('daily_learning_summaries');
  },
};
