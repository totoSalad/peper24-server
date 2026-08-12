import type { Context } from 'egg';
import { AppError } from '../module/system/error/AppError';

const mutationMethods = new Set([ 'POST', 'PUT', 'PATCH', 'DELETE' ]);

function configuredOrigins(): Set<string> {
  return new Set(
    (process.env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map(origin => origin.trim())
      .filter(Boolean),
  );
}

export default function requestSecurity() {
  return async (ctx: Context, next: () => Promise<unknown>) => {
    if (!ctx.path.startsWith('/api/') || !mutationMethods.has(ctx.method)) {
      await next();
      return;
    }

    const contentLength = Number(ctx.get('content-length') || 0);
    if (contentLength > 0 && !ctx.is('application/json')) {
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', '修改操作只接受 JSON', 415);
    }

    const originHeader = ctx.get('origin');
    const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
    const allowedOrigins = configuredOrigins();
    const sameOrigin = `${ctx.protocol}://${ctx.host}`;
    if (origin && origin !== sameOrigin && !allowedOrigins.has(origin)) {
      throw new AppError('INVALID_ORIGIN', '请求来源不受信任', 403);
    }
    if (!origin && process.env.NODE_ENV === 'production') {
      throw new AppError('INVALID_ORIGIN', '请求来源不受信任', 403);
    }

    await next();
  };
}
