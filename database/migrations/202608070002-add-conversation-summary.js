'use strict';

// 折叠消息的运行摘要：summary 存 running summary 文本，summary_folded_until
// 记录摘要已覆盖的前缀消息条数（折叠边界，用于增量总结新折叠段）。
module.exports = {
  async up(driver) {
    await driver.query(`
      ALTER TABLE conversations
        ADD COLUMN summary TEXT NULL,
        ADD COLUMN summary_folded_until INT NULL
    `);
  },

  async down(driver) {
    await driver.query(`
      ALTER TABLE conversations
        DROP COLUMN summary_folded_until,
        DROP COLUMN summary
    `);
  },
};
