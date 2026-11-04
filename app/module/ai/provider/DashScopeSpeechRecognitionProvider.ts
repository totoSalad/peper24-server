import { AccessLevel, SingletonProto } from '@eggjs/tegg';
import { AppError } from '../../system/error/AppError';
import { SpeechRecognitionProvider } from '../../speech/service/SpeechPorts';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null ? value as JsonRecord : {};
}

function config() {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new AppError('SPEECH_PROVIDER_UNAVAILABLE', '语音服务暂未配置', 503);
  return {
    apiKey,
    baseUrl: (process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope.aliyuncs.com').replace(/\/$/, ''),
    model: process.env.DASHSCOPE_ASR_MODEL ?? 'paraformer-v2',
  };
}

async function requestJson(url: string, init: RequestInit): Promise<JsonRecord> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
    const json = asRecord(await response.json());
    if (!response.ok) throw new Error(`DashScope ${response.status}`);
    return json;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('SPEECH_PROVIDER_FAILED', '语音识别服务请求失败', 502);
  }
}

@SingletonProto({ name: 'SpeechRecognitionProvider', accessLevel: AccessLevel.PUBLIC })
export class DashScopeSpeechRecognitionProvider extends SpeechRecognitionProvider {
  async submit(input: { audioUrl: string }): Promise<{ taskId: string }> {
    const configured = config();
    const json = await requestJson(
      `${configured.baseUrl}/api/v1/services/audio/asr/transcription`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${configured.apiKey}`,
          'Content-Type': 'application/json',
          'X-DashScope-Async': 'enable',
        },
        body: JSON.stringify({
          model: configured.model,
          input: { file_urls: [ input.audioUrl ] },
          parameters: { channel_id: [ 0 ], language_hints: [ 'en' ] },
        }),
      },
    );
    const taskId = String(asRecord(json.output).task_id ?? '');
    if (!taskId) throw new AppError('SPEECH_PROVIDER_FAILED', '语音识别任务创建失败', 502);
    return { taskId };
  }

  async poll(taskId: string) {
    const configured = config();
    const json = await requestJson(
      `${configured.baseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}`,
      { method: 'GET', headers: { Authorization: `Bearer ${configured.apiKey}` } },
    );
    const output = asRecord(json.output);
    const status = String(output.task_status ?? '').toUpperCase();
    if ([ 'PENDING', 'RUNNING', 'UNKNOWN' ].includes(status)) {
      return { status: 'processing' as const };
    }
    if (status !== 'SUCCEEDED') {
      return { status: 'failed' as const, code: 'SPEECH_PROVIDER_FAILED' };
    }
    const results = Array.isArray(output.results) ? output.results.map(asRecord) : [];
    const transcriptionUrl = String(results[0]?.transcription_url ?? '');
    if (!transcriptionUrl) return { status: 'failed' as const, code: 'SPEECH_PROVIDER_FAILED' };
    const transcription = await requestJson(transcriptionUrl, { method: 'GET' });
    const transcripts = Array.isArray(transcription.transcripts)
      ? transcription.transcripts.map(asRecord) : [];
    const transcript = transcripts.map(item => String(item.text ?? ''))
      .filter(Boolean)
      .join(' ')
      .trim();
    const durationMs = Number(asRecord(transcription.properties).original_duration_in_milliseconds);
    return {
      status: 'completed' as const,
      transcript,
      ...(Number.isFinite(durationMs) && durationMs > 0 ? { durationMs } : {}),
    };
  }
}
