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
import {
  MessageIdSchema,
  RecordingIdSchema,
  SignVoiceUploadSchema,
  StartTranscriptionSchema,
} from '../schema/SpeechSchemas';
import { SpeechService } from '../service/SpeechService';

@HTTPController({ path: '/api/v1/uploads' })
export class UploadController {
  @Inject() private accountService: AccountService;
  @Inject() private speechService: SpeechService;

  @HTTPMethod({ method: HTTPMethodEnum.POST, path: '/sign' })
  async sign(@HTTPBody() body: unknown, @Context() ctx: EggContext) {
    const user = await this.accountService.getCurrentUser(readSessionId(ctx));
    const upload = await this.speechService.createVoiceUpload(
      user.id, SignVoiceUploadSchema.parse(body),
    );
    ctx.status = 201;
    return { data: upload, requestId: ctx.state.requestId };
  }
}

@HTTPController({ path: '/api/v1/speech' })
export class SpeechController {
  @Inject() private accountService: AccountService;
  @Inject() private speechService: SpeechService;

  @HTTPMethod({ method: HTTPMethodEnum.POST, path: '/transcriptions' })
  async transcribe(@HTTPBody() body: unknown, @Context() ctx: EggContext) {
    const user = await this.accountService.getCurrentUser(readSessionId(ctx));
    const input = StartTranscriptionSchema.parse(body);
    const transcription = await this.speechService.startTranscription(
      user.id, input.recordingId, input.durationMs,
    );
    ctx.status = transcription.status === 'processing' ? 202 : 200;
    return { data: transcription, requestId: ctx.state.requestId };
  }

  @HTTPMethod({ method: HTTPMethodEnum.GET, path: '/transcriptions/:recordingId' })
  async getTranscription(@HTTPParam() recordingId: string, @Context() ctx: EggContext) {
    const user = await this.accountService.getCurrentUser(readSessionId(ctx));
    const transcription = await this.speechService.getTranscription(
      user.id, RecordingIdSchema.parse(recordingId),
    );
    ctx.status = transcription.status === 'processing' ? 202 : 200;
    return { data: transcription, requestId: ctx.state.requestId };
  }
}

@HTTPController({ path: '/api/v1/messages' })
export class MessageVoiceRecordingController {
  @Inject() private accountService: AccountService;
  @Inject() private speechService: SpeechService;

  @HTTPMethod({ method: HTTPMethodEnum.GET, path: '/:messageId/voice-recording' })
  async get(@HTTPParam() messageId: string, @Context() ctx: EggContext) {
    const user = await this.accountService.getCurrentUser(readSessionId(ctx));
    const recording = await this.speechService.getMessageVoiceRecording(
      user.id, MessageIdSchema.parse(messageId),
    );
    return { data: recording, requestId: ctx.state.requestId };
  }
}
