import { AccessLevel, Inject, SingletonProto } from '@eggjs/tegg';

export abstract class DependencyProbe {
  abstract check(): Promise<void>;
}

export interface ReadinessResult {
  ready: boolean;
  dependencies: {
    mysql: 'up' | 'down';
    redis: 'up' | 'down';
  };
}

@SingletonProto({ accessLevel: AccessLevel.PUBLIC })
export class ReadinessService {
  constructor(
    @Inject('DatabaseHealthProbe') private readonly database: DependencyProbe,
    @Inject('RedisHealthProbe') private readonly redis: DependencyProbe,
  ) {}

  async check(): Promise<ReadinessResult> {
    const [ mysql, redis ] = await Promise.allSettled([
      this.database.check(),
      this.redis.check(),
    ]);
    const result: ReadinessResult = {
      ready: mysql.status === 'fulfilled' && redis.status === 'fulfilled',
      dependencies: {
        mysql: mysql.status === 'fulfilled' ? 'up' : 'down',
        redis: redis.status === 'fulfilled' ? 'up' : 'down',
      },
    };
    return result;
  }
}
