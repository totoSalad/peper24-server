'use strict';

module.exports = {
  async up(driver) {
    await driver.query(`
      ALTER TABLE memories
      ADD COLUMN admission_score TINYINT UNSIGNED NOT NULL DEFAULT 6 AFTER confidence,
      ADD COLUMN explicitly_requested TINYINT(1) NOT NULL DEFAULT 0 AFTER admission_score,
      ADD COLUMN admission_reason VARCHAR(500) NOT NULL DEFAULT 'Legacy memory' AFTER explicitly_requested,
      ADD COLUMN assessment_json TEXT NULL AFTER admission_reason
    `);
    await driver.query(`
      UPDATE memories
      SET assessment_json = JSON_OBJECT(
        'legacy', TRUE,
        'previousExpiresAt', IF(expires_at IS NULL, NULL, DATE_FORMAT(expires_at, '%Y-%m-%dT%H:%i:%s.%fZ'))
      )
      WHERE assessment_json IS NULL
    `);
    await driver.query(`
      ALTER TABLE memories
      MODIFY COLUMN assessment_json TEXT NOT NULL
    `);
    await driver.query(`
      UPDATE memories
      SET expires_at = NULL
      WHERE type <> 'short_term' AND status = 'active'
    `);
    await driver.query(`
      ALTER TABLE messages
      ADD KEY idx_messages_memory_pending (
        role, status, memory_scanned_at, conversation_id, created_at
      )
    `);
  },

  async down(driver) {
    await driver.query(`
      ALTER TABLE messages DROP INDEX idx_messages_memory_pending
    `);
    await driver.query(`
      UPDATE memories
      SET expires_at = COALESCE(
        STR_TO_DATE(
          JSON_UNQUOTE(JSON_EXTRACT(assessment_json, '$.previousExpiresAt')),
          '%Y-%m-%dT%H:%i:%s.%fZ'
        ),
        CASE
          WHEN type = 'preference' THEN DATE_ADD(updated_at, INTERVAL 180 DAY)
          WHEN type <> 'short_term' THEN DATE_ADD(updated_at, INTERVAL 365 DAY)
          ELSE expires_at
        END
      )
      WHERE type <> 'short_term' AND status = 'active'
    `);
    await driver.query(`
      ALTER TABLE memories
      DROP COLUMN assessment_json,
      DROP COLUMN admission_reason,
      DROP COLUMN explicitly_requested,
      DROP COLUMN admission_score
    `);
  },
};
