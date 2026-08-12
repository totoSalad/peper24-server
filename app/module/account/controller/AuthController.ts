import {
  Context,
  EggContext,
  HTTPBody,
  HTTPController,
  HTTPMethod,
  HTTPMethodEnum,
  Inject,
} from '@eggjs/tegg';
import { SESSION_COOKIE_NAME, readSessionId } from '../../../middleware/auth';
import { AccountService } from '../service/AccountService';
import { LoginSchema, RegisterAccountSchema } from '../schema/AccountSchemas';

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function setSessionCookie(ctx: EggContext, sessionId: string): void {
  ctx.cookies.set(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: ctx.app.config.env === 'prod',
    sameSite: 'lax',
    signed: false,
    overwrite: true,
    maxAge: SESSION_MAX_AGE_MS,
  });
}

@HTTPController({ path: '/api/v1/auth' })
export class AuthController {
  @Inject()
  private accountService: AccountService;

  @HTTPMethod({ method: HTTPMethodEnum.POST, path: '/register' })
  async register(@HTTPBody() body: unknown, @Context() ctx: EggContext) {
    const result = await this.accountService.register(RegisterAccountSchema.parse(body));
    setSessionCookie(ctx, result.sessionId);
    ctx.status = 201;
    return { data: { user: result.user }, requestId: ctx.state.requestId };
  }

  @HTTPMethod({ method: HTTPMethodEnum.POST, path: '/login' })
  async login(@HTTPBody() body: unknown, @Context() ctx: EggContext) {
    const result = await this.accountService.login(LoginSchema.parse(body));
    setSessionCookie(ctx, result.sessionId);
    return { data: { user: result.user }, requestId: ctx.state.requestId };
  }

  @HTTPMethod({ method: HTTPMethodEnum.POST, path: '/logout' })
  async logout(@Context() ctx: EggContext) {
    await this.accountService.logout(readSessionId(ctx));
    ctx.cookies.set(SESSION_COOKIE_NAME, null, {
      httpOnly: true,
      secure: ctx.app.config.env === 'prod',
      sameSite: 'lax',
      signed: false,
      overwrite: true,
    });
    ctx.status = 204;
  }
}
