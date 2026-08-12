'use strict';

module.exports = {
  async up(driver) {
    await driver.query(`
      ALTER TABLE memories
      ADD COLUMN summary VARCHAR(500) NULL AFTER content
    `);
    await driver.query(`
      UPDATE memories SET summary = content WHERE summary IS NULL
    `);
    await driver.query(`
      ALTER TABLE memories
      MODIFY COLUMN summary VARCHAR(500) NOT NULL
    `);
  },

  async down(driver) {
    await driver.query(`
      ALTER TABLE memories
      DROP COLUMN summary
    `);
  },
};
