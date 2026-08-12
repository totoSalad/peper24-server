import { strict as assert } from 'node:assert';
import { DependencyProbe, ReadinessService } from '../../../app/module/system/service/ReadinessService';

class StubProbe extends DependencyProbe {
  constructor(private readonly error?: Error) {
    super();
  }

  async check(): Promise<void> {
    if (this.error) throw this.error;
  }
}

describe('ReadinessService', () => {
  it('reports ready when MySQL and Redis are reachable', async () => {
    const service = new ReadinessService(new StubProbe(), new StubProbe());

    assert.deepEqual(await service.check(), {
      ready: true,
      dependencies: { mysql: 'up', redis: 'up' },
    });
  });

  it('reports only the unavailable dependency without leaking its error', async () => {
    const service = new ReadinessService(
      new StubProbe(new Error('connect ECONNREFUSED mysql.internal:3306')),
      new StubProbe(),
    );

    assert.deepEqual(await service.check(), {
      ready: false,
      dependencies: { mysql: 'down', redis: 'up' },
    });
  });
});
