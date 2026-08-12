'use strict';

module.exports = {
  async up(driver) {
    await driver.query(`
      ALTER TABLE memories
      ADD UNIQUE KEY uk_memories_user_type_key (user_id, type, normalized_key)
    `);
  },

  async down(driver) {
    await driver.query('ALTER TABLE memories DROP INDEX uk_memories_user_type_key');
  },
};
