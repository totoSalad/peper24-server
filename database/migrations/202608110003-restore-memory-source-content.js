'use strict';

module.exports = {
  async up(driver) {
    await driver.query(`
      INSERT INTO memory_change_logs (
        memory_id, user_id, action, before_json, after_json, created_at
      )
      SELECT
        m.id,
        m.user_id,
        'restore_source',
        JSON_OBJECT('content', m.content),
        JSON_OBJECT('content', source.content),
        UTC_TIMESTAMP(3)
      FROM memories m
      JOIN (
        SELECT memory_id, content
        FROM (
          SELECT
            ms.memory_id,
            msg.content,
            ROW_NUMBER() OVER (
              PARTITION BY ms.memory_id
              ORDER BY ms.created_at, msg.created_at, msg.sequence, msg.id
            ) AS source_order
          FROM memory_sources ms
          JOIN messages msg ON msg.id = ms.message_id
          WHERE msg.role = 'user'
        ) ranked_sources
        WHERE source_order = 1
      ) source ON source.memory_id = m.id
      WHERE m.content <> source.content
        AND NOT EXISTS (
          SELECT 1 FROM memory_change_logs corrections
          WHERE corrections.memory_id = m.id AND corrections.action = 'correct'
        )
    `);
    await driver.query(`
      UPDATE memories m
      JOIN (
        SELECT memory_id, JSON_UNQUOTE(JSON_EXTRACT(after_json, '$.content')) AS content
        FROM memory_change_logs
        WHERE action = 'restore_source'
      ) restored ON restored.memory_id = m.id
      SET m.content = restored.content
    `);
  },

  async down(driver) {
    await driver.query(`
      UPDATE memories m
      JOIN (
        SELECT memory_id, JSON_UNQUOTE(JSON_EXTRACT(before_json, '$.content')) AS content
        FROM memory_change_logs
        WHERE action = 'restore_source'
      ) restored ON restored.memory_id = m.id
      SET m.content = restored.content
    `);
    await driver.query(`
      DELETE FROM memory_change_logs WHERE action = 'restore_source'
    `);
  },
};
