import {
  Context, EggContext, HTTPController, HTTPMethod, HTTPMethodEnum, HTTPParam, Inject,
} from '@eggjs/tegg';
import { readSessionId } from '../../../middleware/auth';
import { AccountService } from '../../account/service/AccountService';
import { LearningSummaryListSchema } from '../schema/LearningSummarySchemas';
import { LearningSummaryService } from '../service/LearningSummaryService';

@HTTPController({ path: '/api/v1/learning-summaries' })
export class LearningSummaryController {
  @Inject() private accountService: AccountService;
  @Inject() private learningSummaryService: LearningSummaryService;

  @HTTPMethod({ method: HTTPMethodEnum.GET, path: '/today' })
  async today(@Context() ctx: EggContext) {
    const user = await this.accountService.getCurrentUser(readSessionId(ctx));
    const summary = await this.learningSummaryService.today(user.id);
    return { data: { summary }, requestId: ctx.state.requestId };
  }

  @HTTPMethod({ method: HTTPMethodEnum.GET, path: '/' })
  async list(@Context() ctx: EggContext) {
    const user = await this.accountService.getCurrentUser(readSessionId(ctx));
    const input = LearningSummaryListSchema.parse(ctx.query);
    const summaries = await this.learningSummaryService.list(user.id, input.cursor, input.limit);
    return { data: { summaries }, requestId: ctx.state.requestId };
  }

  @HTTPMethod({ method: HTTPMethodEnum.GET, path: '/:date' })
  async get(@HTTPParam() date: string, @Context() ctx: EggContext) {
    const user = await this.accountService.getCurrentUser(readSessionId(ctx));
    const summary = await this.learningSummaryService.get(user.id, date);
    if (!summary) {
      ctx.status = 404;
      return {
        error: { code: 'SUMMARY_NOT_FOUND', message: '学习小结不存在' },
        requestId: ctx.state.requestId,
      };
    }
    return { data: { summary }, requestId: ctx.state.requestId };
  }
}
