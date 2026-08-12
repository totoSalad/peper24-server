'use strict';

module.exports = {
  async up(driver) {
    await driver.query(`
      CREATE TABLE voice_recordings (
        id CHAR(26) CHARACTER SET ascii NOT NULL,
        user_id CHAR(26) CHARACTER SET ascii NOT NULL,
        message_id CHAR(26) CHARACTER SET ascii NULL,
        oss_key VARCHAR(512) CHARACTER SET ascii NOT NULL,
        content_type VARCHAR(64) CHARACTER SET ascii NOT NULL,
        size_bytes BIGINT UNSIGNED NOT NULL,
        duration_ms INT UNSIGNED NULL,
        status VARCHAR(24) CHARACTER SET ascii NOT NULL,
        provider_task_id VARCHAR(128) CHARACTER SET ascii NULL,
        transcript TEXT NULL,
        error_code VARCHAR(128) CHARACTER SET ascii NULL,
        expires_at DATETIME(3) NOT NULL,
        deleted_at DATETIME(3) NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_voice_recordings_oss_key (oss_key),
        UNIQUE KEY uk_voice_recordings_message (message_id),
        KEY idx_voice_recordings_user_created (user_id, created_at),
        KEY idx_voice_recordings_expiry (expires_at, deleted_at),
        CONSTRAINT fk_voice_recordings_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_voice_recordings_message FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await driver.query(`
      CREATE TABLE speech_audio_assets (
        id CHAR(26) CHARACTER SET ascii NOT NULL,
        cache_key CHAR(64) CHARACTER SET ascii NOT NULL,
        provider VARCHAR(32) CHARACTER SET ascii NOT NULL,
        model VARCHAR(128) CHARACTER SET ascii NOT NULL,
        voice VARCHAR(64) CHARACTER SET ascii NOT NULL,
        language VARCHAR(32) CHARACTER SET ascii NOT NULL,
        text_hash CHAR(64) CHARACTER SET ascii NOT NULL,
        oss_key VARCHAR(512) CHARACTER SET ascii NULL,
        format VARCHAR(16) CHARACTER SET ascii NOT NULL,
        duration_ms INT UNSIGNED NULL,
        status VARCHAR(24) CHARACTER SET ascii NOT NULL,
        error_code VARCHAR(128) CHARACTER SET ascii NULL,
        generation_started_at DATETIME(3) NOT NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_speech_audio_assets_cache (cache_key),
        UNIQUE KEY uk_speech_audio_assets_oss_key (oss_key),
        KEY idx_speech_audio_assets_status_started (status, generation_started_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await driver.query(`
      CREATE TABLE message_audios (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        message_id CHAR(26) CHARACTER SET ascii NOT NULL,
        asset_id CHAR(26) CHARACTER SET ascii NOT NULL,
        segment_index SMALLINT UNSIGNED NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uk_message_audios_segment (message_id, segment_index),
        KEY idx_message_audios_asset (asset_id),
        CONSTRAINT fk_message_audios_message FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE,
        CONSTRAINT fk_message_audios_asset FOREIGN KEY (asset_id) REFERENCES speech_audio_assets (id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  },

  async down(driver) {
    await driver.dropTable('message_audios');
    await driver.dropTable('speech_audio_assets');
    await driver.dropTable('voice_recordings');
  },
};
