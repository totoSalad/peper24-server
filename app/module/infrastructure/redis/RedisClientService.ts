import { AccessLevel, SingletonProto } from '@eggjs/tegg';
import Redis from 'ioredis';

@SingletonProto({ accessLevel: AccessLevel.PUBLIC })
export class RedisClientService {
  private client?: Redis;

  async getClient(): Promise<Redis> {
    if (!this.client) {
      this.client = new Redis({
        host: process.env.REDIS_HOST ?? '127.0.0.1',
        port: Number(process.env.REDIS_PORT ?? 6379),
        password: process.env.REDIS_PASSWORD || undefined,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        keyPrefix: process.env.REDIS_KEY_PREFIX ?? 'peper24:',
      });
    }
    if (this.client.status === 'wait') await this.client.connect();
    return this.client;
  }
}
