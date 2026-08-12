import {
  Context,
  EggContext,
  HTTPBody,
  HTTPController,
  HTTPMethod,
  HTTPMethodEnum,
  Inject,
} from '@eggjs/tegg';
import { readSessionId } from '../../../middleware/auth';
import { UpdateProfileSchema } from '../schema/AccountSchemas';
import { AccountService } from '../service/AccountService';

@HTTPController({ path: '/api/v1/me' })
export class ProfileController {
  @Inject()
  private accountService: AccountService;

  @HTTPMethod({ method: HTTPMethodEnum.GET, path: '/' })
  async getCurrentUser(@Context() ctx: EggContext) {
    const user = await this.accountService.getCurrentUser(readSessionId(ctx));
    return { data: { user }, requestId: ctx.state.requestId };
  }

  @HTTPMethod({ method: HTTPMethodEnum.PATCH, path: '/profile' })
  async updateProfile(@HTTPBody() body: unknown, @Context() ctx: EggContext) {
    const user = await this.accountService.updateProfile(
      readSessionId(ctx),
      UpdateProfileSchema.parse(body),
    );
    return { data: { user }, requestId: ctx.state.requestId };
  }
}
