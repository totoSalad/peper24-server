import {
  Context, EggContext, HTTPController, HTTPMethod, HTTPMethodEnum, HTTPParam, Inject,
} from '@eggjs/tegg';
import { readSessionId } from '../../../middleware/auth';
import { AccountService } from '../../account/service/AccountService';
import { TranslationService } from '../service/TranslationService';

@HTTPController({ path: '/api/v1/messages' })
export class TranslationController {
  @Inject() private accountService: AccountService;
  @Inject() private translationService: TranslationService;

  @HTTPMethod({ method: HTTPMethodEnum.POST, path: '/:messageId/translation' })
  async translate(@HTTPParam() messageId: string, @Context() ctx: EggContext) {
    const user = await this.accountService.getCurrentUser(readSessionId(ctx));
    const result = await this.translationService.translateMessage(user.id, messageId);
    return { data: result, requestId: ctx.state.requestId };
  }
}
