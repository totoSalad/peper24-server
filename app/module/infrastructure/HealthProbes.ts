import { AccessLevel, Inject, SingletonProto } from '@eggjs/tegg';
import { DependencyProbe } from '../system/service/ReadinessService';
import { DatabaseService } from './database/DatabaseService';
import { RedisClientService } from './redis/RedisClientService';

@SingletonProto({ name: 'DatabaseHealthProbe', accessLevel: AccessLevel.PUBLIC })
export class DatabaseHealthProbe extends DependencyProbe {
  @Inject()
  private databaseService: DatabaseService;

  async check(): Promise<void> {
    const realm = await this.databaseService.getRealm();
    await realm.query('SELECT 1');
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
