'use strict';

module.exports = {
  async up(driver) {
    // Leoric 2's MySQL DDL builder adds AUTO_INCREMENT to every primary key.
    // ULID keys are strings, so the migration uses explicit MySQL DDL.
    await driver.query(`
      CREATE TABLE users (
        id CHAR(26) CHARACTER SET ascii NOT NULL,
        email VARCHAR(254) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_users_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await driver.query(`
      CREATE TABLE user_profiles (
        user_id CHAR(26) CHARACTER SET ascii NOT NULL,
        display_name VARCHAR(50) NOT NULL,
        age INT NULL,
        occupation VARCHAR(80) NULL,
        english_level VARCHAR(2) CHARACTER SET ascii NOT NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (user_id),
        CONSTRAINT fk_user_profiles_user_id
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  },

  async down(driver) {
    await driver.dropTable('user_profiles');
    await driver.dropTable('users');
  },
};
