import type { Context } from 'egg';
import { ulid } from 'ulid';

export default function requestContext() {
  return async (ctx: Context, next: () => Promise<unknown>) => {
    const requestIdHeader = ctx.get('x-request-id');
    const incoming = (Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader).trim();
    const requestId = incoming && incoming.length <= 128 ? incoming : ulid();
    ctx.state.requestId = requestId;
    ctx.set('x-request-id', requestId);
    await next();
  };
}
