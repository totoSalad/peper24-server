'use strict';

module.exports = {
  async up(driver) {
    await driver.query(`
      UPDATE memories
      SET
        admission_score = GREATEST(
          0,
          CAST(admission_score AS SIGNED)
            - CAST(JSON_UNQUOTE(JSON_EXTRACT(assessment_json, '$.scores.stability')) AS SIGNED)
        ),
        assessment_json = JSON_SET(
          JSON_REMOVE(assessment_json, '$.scores.stability'),
          '$.rawAdmissionScore',
          CAST(JSON_UNQUOTE(JSON_EXTRACT(assessment_json, '$.rawAdmissionScore')) AS SIGNED)
            - CAST(JSON_UNQUOTE(JSON_EXTRACT(assessment_json, '$.scores.stability')) AS SIGNED),
          '$.previousStabilityScore',
          CAST(JSON_UNQUOTE(JSON_EXTRACT(assessment_json, '$.scores.stability')) AS UNSIGNED)
        )
      WHERE JSON_CONTAINS_PATH(assessment_json, 'one', '$.scores.stability') = 1
    `);
  },

  async down(driver) {
    await driver.query(`
      UPDATE memories
      SET
        admission_score = LEAST(
          255,
          admission_score
            + CAST(JSON_UNQUOTE(JSON_EXTRACT(assessment_json, '$.previousStabilityScore')) AS UNSIGNED)
        ),
        assessment_json = JSON_REMOVE(
          JSON_SET(
            assessment_json,
            '$.scores.stability',
            CAST(JSON_UNQUOTE(JSON_EXTRACT(assessment_json, '$.previousStabilityScore')) AS UNSIGNED),
            '$.rawAdmissionScore',
            CAST(JSON_UNQUOTE(JSON_EXTRACT(assessment_json, '$.rawAdmissionScore')) AS SIGNED)
              + CAST(JSON_UNQUOTE(JSON_EXTRACT(assessment_json, '$.previousStabilityScore')) AS SIGNED)
          ),
          '$.previousStabilityScore'
        )
      WHERE JSON_CONTAINS_PATH(assessment_json, 'one', '$.previousStabilityScore') = 1
    `);
  },
};
