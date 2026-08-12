'use strict';

module.exports = {
  async up(driver) {
    await driver.query(`
      ALTER TABLE conversations
        ADD COLUMN next_message_sequence BIGINT UNSIGNED NULL
    `);
    await driver.query(`
      ALTER TABLE messages
        ADD COLUMN sequence BIGINT UNSIGNED NULL
    `);

    // reply_to_message_id is the authoritative historical ordering relation.
    // Give a reply the same turn key as its user message, then place the user first.
    await driver.query(`
      CREATE TEMPORARY TABLE message_sequence_backfill (
        id CHAR(26) CHARACTER SET ascii NOT NULL PRIMARY KEY,
        message_sequence BIGINT UNSIGNED NOT NULL
      ) ENGINE=InnoDB
    `);
    await driver.query(`
      INSERT INTO message_sequence_backfill (id, message_sequence)
      SELECT ordered.id,
        ROW_NUMBER() OVER (
          PARTITION BY ordered.conversation_id
          ORDER BY ordered.turn_created_at, ordered.turn_id, ordered.position_in_turn, ordered.id
        ) AS message_sequence
      FROM (
        SELECT
          message.id,
          message.conversation_id,
          COALESCE(parent.created_at, message.created_at) AS turn_created_at,
          COALESCE(parent.id, message.id) AS turn_id,
          CASE WHEN message.reply_to_message_id IS NULL THEN 0 ELSE 1 END AS position_in_turn
        FROM messages message
        LEFT JOIN messages parent ON parent.id = message.reply_to_message_id
      ) ordered
    `);
    await driver.query(`
      UPDATE messages message
      JOIN message_sequence_backfill backfill ON backfill.id = message.id
      SET message.sequence = backfill.message_sequence
    `);
    await driver.query(`
      UPDATE conversations conversation
      LEFT JOIN (
        SELECT conversation_id, MAX(sequence) + 1 AS next_sequence
        FROM messages
        GROUP BY conversation_id
      ) allocated ON allocated.conversation_id = conversation.id
      SET conversation.next_message_sequence = COALESCE(allocated.next_sequence, 1)
    `);
    await driver.query('DROP TEMPORARY TABLE message_sequence_backfill');

    await driver.query(`
      ALTER TABLE conversations
        MODIFY next_message_sequence BIGINT UNSIGNED NOT NULL DEFAULT 1
    `);
    await driver.query(`
      ALTER TABLE messages
        MODIFY sequence BIGINT UNSIGNED NOT NULL,
        ADD UNIQUE KEY uk_messages_conversation_sequence (conversation_id, sequence)
    `);
  },

  async down(driver) {
    await driver.query(`
      ALTER TABLE messages
        DROP INDEX uk_messages_conversation_sequence,
        DROP COLUMN sequence
    `);
    await driver.query(`
      ALTER TABLE conversations
        DROP COLUMN next_message_sequence
    `);
  },
};
