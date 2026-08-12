import { AccessLevel, Inject, SingletonProto } from '@eggjs/tegg';
import {
  SessionStore,
} from '../../account/service/AccountPorts';
import { RedisClientService } from './RedisClientService';

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

@SingletonProto({ name: 'SessionStore', accessLevel: AccessLevel.PUBLIC })
export class RedisSessionStore extends SessionStore {
  @Inject()
  private redisClientService: RedisClientService;

  async create(sessionId: string, userId: string): Promise<void> {
    const redis = await this.redisClientService.getClient();
    await redis.set(`session:${sessionId}`, userId, 'EX', SESSION_TTL_SECONDS);
  }

  async findUserId(sessionId: string): Promise<string | null> {
    const redis = await this.redisClientService.getClient();
    return redis.get(`session:${sessionId}`);
  }

  async delete(sessionId: string): Promise<void> {
    const redis = await this.redisClientService.getClient();
    await redis.del(`session:${sessionId}`);
  }
}
