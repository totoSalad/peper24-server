'use strict';

module.exports = {
  async up(driver) {
    await driver.query(`
      ALTER TABLE conversations
      ADD COLUMN memory_scanned_through_sequence BIGINT UNSIGNED NOT NULL DEFAULT 0
        AFTER summary_folded_until
    `);
    await driver.query(`
      UPDATE conversations c
      LEFT JOIN (
        SELECT
          conversation_id,
          COALESCE(
            MIN(
              CASE
                WHEN role = 'user' AND status = 'completed' AND memory_scanned_at IS NULL
                  THEN sequence
              END
            ) - 1,
            MAX(sequence),
            0
          ) AS scan_cursor
        FROM messages
        GROUP BY conversation_id
      ) progress ON progress.conversation_id = c.id
      SET c.memory_scanned_through_sequence = COALESCE(progress.scan_cursor, 0)
    `);
    await driver.query(`
      ALTER TABLE messages
      DROP INDEX idx_messages_memory_pending,
      DROP INDEX idx_messages_memory_scan,
      DROP COLUMN memory_scanned_at,
      DROP COLUMN tool_events_json
    `);
    await driver.query(`
      ALTER TABLE conversations
      DROP COLUMN memory_dirty_at
    `);
  },

  async down(driver) {
    await driver.query(`
      ALTER TABLE conversations
      ADD COLUMN memory_dirty_at DATETIME(3) NULL AFTER status
    `);
    await driver.query(`
      ALTER TABLE messages
      ADD COLUMN tool_events_json TEXT NULL AFTER correction_json,
      ADD COLUMN memory_scanned_at DATETIME(3) NULL AFTER client_request_id,
      ADD KEY idx_messages_memory_scan (memory_scanned_at, role, status, created_at),
      ADD KEY idx_messages_memory_pending (
        role, status, memory_scanned_at, conversation_id, created_at
      )
    `);
    await driver.query(`
      UPDATE messages m
      JOIN conversations c ON c.id = m.conversation_id
      SET m.memory_scanned_at = c.updated_at
      WHERE m.role = 'user' AND m.status = 'completed'
        AND m.sequence <= c.memory_scanned_through_sequence
    `);
    await driver.query(`
      ALTER TABLE conversations
      DROP COLUMN memory_scanned_through_sequence
    `);
  },
};
