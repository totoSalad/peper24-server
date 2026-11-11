import { AccessLevel, Inject, SingletonProto } from '@eggjs/tegg';
import { DependencyProbe } from '../system/service/ReadinessService';
import { DatabaseService } from './database/DatabaseService';
import { RedisClientService } from './redis/RedisClientService';

const REQUIRED_TABLES = [
  'users', 'user_profiles', 'conversations', 'messages', 'ai_usage_logs',
  'grammar_error_patterns', 'grammar_error_occurrences', 'memories', 'voice_recordings',
];

@SingletonProto({ name: 'DatabaseHealthProbe', accessLevel: AccessLevel.PUBLIC })
export class DatabaseHealthProbe extends DependencyProbe {
  @Inject()
  private databaseService: DatabaseService;

  async check(): Promise<void> {
    const realm = await this.databaseService.getRealm();
    const placeholders = REQUIRED_TABLES.map(() => '?').join(', ');
    const result = await realm.query(`
      SELECT TABLE_NAME AS name FROM information_schema.tables
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
        AND TABLE_NAME IN (${placeholders})
    `, REQUIRED_TABLES);
    const present = new Set(result.rows.map(row => String(row.name)));
    if (REQUIRED_TABLES.some(table => !present.has(table))) {
      throw new Error('Database schema is incomplete');
    }
  }
}

@SingletonProto({ name: 'RedisHealthProbe', accessLevel: AccessLevel.PUBLIC })
export class RedisHealthProbe extends DependencyProbe {
  @Inject()
  private redisClientService: RedisClientService;

  async check(): Promise<void> {
    const redis = await this.redisClientService.getClient();
    await redis.ping();
  }
}
