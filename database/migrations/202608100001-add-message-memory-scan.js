'use strict';

module.exports = {
  async up(driver) {
    await driver.query(`
      ALTER TABLE messages
      ADD COLUMN memory_scanned_at DATETIME(3) NULL,
      ADD KEY idx_messages_memory_scan (memory_scanned_at, role, status, created_at)
    `);
  },

  async down(driver) {
    await driver.query(`
      ALTER TABLE messages
      DROP INDEX idx_messages_memory_scan,
      DROP COLUMN memory_scanned_at
    `);
  },
};
