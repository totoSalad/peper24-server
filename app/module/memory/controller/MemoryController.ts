import {
  Context, EggContext, HTTPBody, HTTPController, HTTPMethod, HTTPMethodEnum, HTTPParam, Inject,
} from '@eggjs/tegg';
import { readSessionId } from '../../../middleware/auth';
import { AccountService } from '../../account/service/AccountService';
import { CorrectMemorySchema } from '../schema/MemorySchemas';
import { MemoryService } from '../service/MemoryService';
import { MemoryExtractionService } from '../service/MemoryExtractionService';

@HTTPController({ path: '/api/v1/memories' })
export class MemoryController {
  @Inject() private accountService: AccountService;
  @Inject() private memoryService: MemoryService;
  @Inject() private memoryExtractionService: MemoryExtractionService;

  @HTTPMethod({ method: HTTPMethodEnum.POST, path: '/extractions' })
  async extract(@Context() ctx: EggContext) {
    const user = await this.accountService.getCurrentUser(readSessionId(ctx));
    const changed = await this.memoryExtractionService.processPendingForUser(user.id);
    return { data: { changedCount: changed.length }, requestId: ctx.state.requestId };
  }

  @HTTPMethod({ method: HTTPMethodEnum.GET, path: '/' })
  async list(@Context() ctx: EggContext) {
    const user = await this.accountService.getCurrentUser(readSessionId(ctx));
    const memories = await this.memoryService.list(user.id);
    return { data: { memories }, requestId: ctx.state.requestId };
  }

  @HTTPMethod({ method: HTTPMethodEnum.PATCH, path: '/:memoryId' })
  async correct(
    @HTTPParam() memoryId: string,
    @HTTPBody() body: unknown,
    @Context() ctx: EggContext,
  ) {
    const user = await this.accountService.getCurrentUser(readSessionId(ctx));
    const input = CorrectMemorySchema.parse(body);
    const memory = await this.memoryService.correct(user.id, memoryId, input.content, input.summary);
    return { data: { memory }, requestId: ctx.state.requestId };
  }

  @HTTPMethod({ method: HTTPMethodEnum.DELETE, path: '/:memoryId' })
  async remove(@HTTPParam() memoryId: string, @Context() ctx: EggContext) {
    const user = await this.accountService.getCurrentUser(readSessionId(ctx));
    await this.memoryService.remove(user.id, memoryId);
    ctx.status = 204;
  }
}
