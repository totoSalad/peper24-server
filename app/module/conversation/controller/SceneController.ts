import {
  Context,
  EggContext,
  HTTPController,
  HTTPMethod,
  HTTPMethodEnum,
  Inject,
} from '@eggjs/tegg';
import { SCENES } from '../../ai/const/scene';
import { readSessionId } from '../../../middleware/auth';
import { AccountService } from '../../account/service/AccountService';

/** 输出陪练话题 + 场景池，供 peper24-app 选择新建会话的话题。 */
@HTTPController({ path: '/api/v1/scenes' })
export class SceneController {
  @Inject()
  private accountService: AccountService;

  @HTTPMethod({ method: HTTPMethodEnum.GET, path: '/' })
  async list(@Context() ctx: EggContext) {
    await this.accountService.getCurrentUser(readSessionId(ctx));
    return { data: { scenes: SCENES }, requestId: ctx.state.requestId };
  }
}
