'use strict';

module.exports = {
  async up(driver) {
    // 词汇富化数据折叠为一个值对象字段 detail（JSON），不再拆 phonetic / part_of_speech / meaning / example 多列。
    await driver.query(`
      ALTER TABLE vocabularies
        ADD COLUMN detail JSON NULL AFTER normalized_expression
    `);
    await driver.query(`
      UPDATE vocabularies
        SET detail = JSON_OBJECT('cnMeaning', meaning, 'enMeaning', '', 'example', example, 'phonetic', phonetic)
        WHERE detail IS NULL
    `);
    await driver.query(`
      ALTER TABLE vocabularies
        DROP COLUMN phonetic,
        DROP COLUMN part_of_speech,
        DROP COLUMN meaning,
        DROP COLUMN example
    `);
    await driver.query(`
      ALTER TABLE vocabularies MODIFY detail JSON NOT NULL
    `);
  },

  async down(driver) {
    await driver.query(`
      ALTER TABLE vocabularies
        ADD COLUMN phonetic VARCHAR(200) NOT NULL DEFAULT '',
        ADD COLUMN part_of_speech VARCHAR(80) NOT NULL DEFAULT '',
        ADD COLUMN meaning VARCHAR(500) NOT NULL DEFAULT '',
        ADD COLUMN example TEXT NULL
    `);
    await driver.query(`
      UPDATE vocabularies SET
        meaning = COALESCE(JSON_UNQUOTE(JSON_EXTRACT(detail, '$.cnMeaning')), ''),
        example = COALESCE(JSON_UNQUOTE(JSON_EXTRACT(detail, '$.example')), ''),
        phonetic = COALESCE(JSON_UNQUOTE(JSON_EXTRACT(detail, '$.phonetic')), '')
    `);
    await driver.query(`
      ALTER TABLE vocabularies DROP COLUMN detail
    `);
  },
};
