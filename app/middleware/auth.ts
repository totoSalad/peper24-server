import type { Context } from 'egg';

export const SESSION_COOKIE_NAME = 'peper24.sid';

export function readSessionId(ctx: Context): string {
  return ctx.cookies.get(SESSION_COOKIE_NAME, { signed: false }) ?? '';
}
