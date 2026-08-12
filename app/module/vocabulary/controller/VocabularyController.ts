import {
  Context, EggContext, HTTPBody, HTTPController, HTTPMethod, HTTPMethodEnum,
  HTTPParam, HTTPQuery, Inject,
} from '@eggjs/tegg';
import { readSessionId } from '../../../middleware/auth';
import { AccountService } from '../../account/service/AccountService';
import { AddVocabularySchema, ReviewAnswerSchema, ReviewLimitSchema } from '../schema/VocabularySchemas';
import { VocabularyService } from '../service/VocabularyService';

@HTTPController({ path: '/api/v1/vocabularies' })
export class VocabularyController {
  @Inject() private accountService: AccountService;
  @Inject() private vocabularyService: VocabularyService;

  @HTTPMethod({ method: HTTPMethodEnum.GET, path: '/' })
  async list(@Context() ctx: EggContext) {
    const user = await this.accountService.getCurrentUser(readSessionId(ctx));
    const vocabularies = await this.vocabularyService.list(user.id);
    return { data: { vocabularies }, requestId: ctx.state.requestId };
  }

  @HTTPMethod({ method: HTTPMethodEnum.POST, path: '/' })
  async add(@HTTPBody() body: unknown, @Context() ctx: EggContext) {
    const user = await this.accountService.getCurrentUser(readSessionId(ctx));
    const input = AddVocabularySchema.parse(body);
    const vocabulary = await this.vocabularyService.addFromSelection(
      user.id, input.expression, input.sourceMessageId, user.profile,
    );
    ctx.status = vocabulary ? 201 : 200;
    return { data: { vocabulary }, requestId: ctx.state.requestId };
  }

  @HTTPMethod({ method: HTTPMethodEnum.DELETE, path: '/:vocabularyId' })
  async remove(@HTTPParam() vocabularyId: string, @Context() ctx: EggContext) {
    const user = await this.accountService.getCurrentUser(readSessionId(ctx));
    await this.vocabularyService.remove(user.id, vocabularyId);
    ctx.status = 204;
  }
}

@HTTPController({ path: '/api/v1/reviews' })
export class ReviewController {
  @Inject() private accountService: AccountService;
  @Inject() private vocabularyService: VocabularyService;

  @HTTPMethod({ method: HTTPMethodEnum.GET, path: '/today' })
  async today(@HTTPQuery() limit: string | undefined, @Context() ctx: EggContext) {
    const user = await this.accountService.getCurrentUser(readSessionId(ctx));
    const reviews = await this.vocabularyService.listDue(user.id, ReviewLimitSchema.parse(limit));
    return { data: { reviews }, requestId: ctx.state.requestId };
  }

  @HTTPMethod({ method: HTTPMethodEnum.POST, path: '/:vocabularyId/answer' })
  async answer(
    @HTTPParam() vocabularyId: string,
    @HTTPBody() body: unknown,
    @Context() ctx: EggContext,
  ) {
    const user = await this.accountService.getCurrentUser(readSessionId(ctx));
    const input = ReviewAnswerSchema.parse(body);
    const review = await this.vocabularyService.answer(
      user.id, vocabularyId, input.result, input.clientRequestId,
    );
    return { data: { review }, requestId: ctx.state.requestId };
  }
}
