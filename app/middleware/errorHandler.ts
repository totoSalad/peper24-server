import type { Context } from 'egg';
import { ZodError } from 'zod';
import { AppError } from '../module/system/error/AppError';

export default function errorHandler() {
  return async (ctx: Context, next: () => Promise<unknown>) => {
    try {
      await next();
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        ctx.status = 400;
        ctx.body = {
          error: {
            code: 'VALIDATION_ERROR',
            message: '请求参数不正确',
            details: error.issues,
          },
          requestId: ctx.state.requestId,
        };
        return;
      }
      if (error instanceof AppError) {
        ctx.status = error.status;
        ctx.body = {
          error: { code: error.code, message: error.message, details: error.details },
          requestId: ctx.state.requestId,
        };
        return;
      }
      ctx.logger.error('[request-error] requestId=%s error=%s', ctx.state.requestId, error);
      ctx.status = 500;
      ctx.body = {
        error: { code: 'INTERNAL_ERROR', message: '服务器暂时无法处理请求' },
        requestId: ctx.state.requestId,
      };
    }
  };
}
