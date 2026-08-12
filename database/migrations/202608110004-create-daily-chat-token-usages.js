'use strict';

module.exports = {
  async up(driver) {
    await driver.query(`
      CREATE TABLE daily_chat_token_usages (
        user_id CHAR(26) CHARACTER SET ascii NOT NULL,
        usage_date DATE NOT NULL,
        token_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (user_id, usage_date),
        CONSTRAINT fk_daily_chat_token_usage_user
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await driver.query(`
      INSERT INTO daily_chat_token_usages (
        user_id, usage_date, token_count, created_at, updated_at
      )
      SELECT
        user_id,
        DATE(created_at),
        SUM(input_tokens + output_tokens),
        MIN(created_at),
        MAX(created_at)
      FROM ai_usage_logs
      WHERE task = 'conversation.chat' AND status = 'success'
      GROUP BY user_id, DATE(created_at)
    `);
  },

  async down(driver) {
    await driver.dropTable('daily_chat_token_usages');
  },
};
