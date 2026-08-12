'use strict';

module.exports = {
  async up(driver) {
    await driver.query('ALTER TABLE messages ADD COLUMN tool_events_json TEXT NULL AFTER correction_json');
  },
  async down(driver) {
    await driver.query('ALTER TABLE messages DROP COLUMN tool_events_json');
  },
};
