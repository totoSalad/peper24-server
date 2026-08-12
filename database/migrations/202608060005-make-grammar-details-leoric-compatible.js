'use strict';

module.exports = {
  async up(driver) {
    await driver.query(`
      ALTER TABLE grammar_error_occurrences
      MODIFY details_json TEXT NOT NULL
    `);
  },

  async down(driver) {
    await driver.query(`
      ALTER TABLE grammar_error_occurrences
      MODIFY details_json JSON NOT NULL
    `);
  },
};
