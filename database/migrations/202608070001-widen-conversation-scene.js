'use strict';

// 场景描述最长超过 120 字符，VARCHAR(80) 会溢出导致新建会话失败（ER_DATA_TOO_LONG）。
// 放宽到 VARCHAR(512)，同时覆盖 topic 使用场景文案的场景。
module.exports = {
  async up(driver) {
    await driver.query(`
      ALTER TABLE conversations
        MODIFY COLUMN scene VARCHAR(512) NULL
    `);
  },

  async down(driver) {
    await driver.query(`
      ALTER TABLE conversations
        MODIFY COLUMN scene VARCHAR(80) NULL
    `);
  },
};
