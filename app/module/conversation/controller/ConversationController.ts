import { PassThrough } from 'node:stream';
import {
  Context,
  EggContext,
  HTTPBody,
  HTTPController,
  HTTPMethod,
  HTTPMethodEnum,
  HTTPParam,
  Inject,
} from '@eggjs/tegg';
import { readSessionId } from '../../../middleware/auth';
import { AccountService } from '../../account/service/AccountService';
import type { ChatEvent } from '../../ai/service/ProductAIService';
import { AppError } from '../../system/error/AppError';
import { CreateConversationSchema, StreamMessageSchema } from '../schema/ConversationSchemas';
import { ConversationService } from '../service/ConversationService';

function writeEvent(stream: PassThrough, event: ChatEvent): void {
  stream.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

@HTTPController({ path: '/api/v1/conversations' })
export class ConversationController {
  @Inject()
  private accountService: AccountService;

  @Inject()
  private conversationService: ConversationService;

  @HTTPMethod({ method: HTTPMethodEnum.POST, path: '/' })
  async create(@HTTPBody() body: unknown, @Context() ctx: EggContext) {
    const user = await this.accountService.getCurrentUser(readSessionId(ctx));
    const result = await this.conversationService.createConversation(
      user.id,
      CreateConversationSchema.parse(body),
      user.profile,
    );
    ctx.status = 201;
    return { data: result, requestId: ctx.state.requestId };
  }

  @HTTPMethod({ method: HTTPMethodEnum.GET, path: '/' })
  async list(@Context() ctx: EggContext) {
    const user = await this.accountService.getCurrentUser(readSessionId(ctx));
    const conversations = await this.conversationService.listConversations(user.id);
    return { data: { conversations }, requestId: ctx.state.requestId };
  }

  @HTTPMethod({ method: HTTPMethodEnum.GET, path: '/:conversationId/messages' })
  async messages(
    @HTTPParam() conversationId: string,
    @Context() ctx: EggContext,
  ) {
    const user = await this.accountService.getCurrentUser(readSessionId(ctx));
    const messages = await this.conversationService.listMessages(user.id, conversationId);
    return { data: { messages }, requestId: ctx.state.requestId };
  }

  @HTTPMethod({ method: HTTPMethodEnum.POST, path: '/:conversationId/messages/stream' })
  async stream(
    @HTTPParam() conversationId: string,
    @HTTPBody() body: unknown,
    @Context() ctx: EggContext,
  ) {
    const user = await this.accountService.getCurrentUser(readSessionId(ctx));
    const input = StreamMessageSchema.parse(body);
    const output = new PassThrough();
    const abortController = new AbortController();
    ctx.req.once('aborted', () => abortController.abort());
    ctx.res.once('close', () => {
      if (!ctx.res.writableEnded) abortController.abort();
    });
    ctx.status = 200;
    ctx.type = 'text/event-stream';
    ctx.set('cache-control', 'no-cache, no-transform');
    ctx.set('connection', 'keep-alive');
    ctx.set('x-accel-buffering', 'no');

    void this.writeStream(output, user.id, conversationId, {
      ...input,
      signal: abortController.signal,
    }, user.profile, ctx);
    return output;
  }

  private async writeStream(
    output: PassThrough,
    userId: string,
    conversationId: string,
    input: {
      content: string;
      clientRequestId: string;
      signal: AbortSignal;
    },
    learner: Parameters<ConversationService['streamMessage']>[3],
    ctx: EggContext,
  ): Promise<void> {
    try {
      for await (const event of this.conversationService.streamMessage(
        userId,
        conversationId,
        input,
        learner,
      )) {
        writeEvent(output, event);
      }
    } catch (error) {
      if (error instanceof AppError) {
        ctx.logger.error(
          '[conversation-stream-error] requestId=%s code=%s message=%s',
          ctx.state.requestId,
          error.code,
          error.message,
        );
        writeEvent(output, {
          type: 'error',
          code: error.code,
          retryable: false,
          message: error.message,
        });
      } else {
        ctx.logger.error(
          '[conversation-stream-error] requestId=%s error=%s',
          ctx.state.requestId,
          error,
        );
        writeEvent(output, {
          type: 'error',
          code: 'INTERNAL_ERROR',
          retryable: true,
          message: '服务器暂时无法处理请求',
        });
      }
    } finally {
      output.end();
    }
  }
}
