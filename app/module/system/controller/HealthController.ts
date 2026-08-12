import {
  Context,
  EggContext,
  HTTPController,
  HTTPMethod,
  HTTPMethodEnum,
  Inject,
} from '@eggjs/tegg';
import { ReadinessService } from '../service/ReadinessService';

@HTTPController({ path: '/api' })
export class HealthController {
  @Inject()
  private readinessService: ReadinessService;

  @HTTPMethod({ method: HTTPMethodEnum.GET, path: '/health' })
  async health(@Context() ctx: EggContext) {
    return {
      data: {
        ok: true,
        service: 'peper24-server',
        timestamp: new Date().toISOString(),
      },
      requestId: ctx.state.requestId,
    };
  }

  @HTTPMethod({ method: HTTPMethodEnum.GET, path: '/ready' })
  async ready(@Context() ctx: EggContext) {
    const result = await this.readinessService.check();
    ctx.status = result.ready ? 200 : 503;
    return { data: result, requestId: ctx.state.requestId };
  }
}
