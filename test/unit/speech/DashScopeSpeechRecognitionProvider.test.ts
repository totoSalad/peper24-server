import { strict as assert } from 'node:assert';
import { DashScopeSpeechRecognitionProvider } from
  '../../../app/module/speech/provider/DashScopeSpeechRecognitionProvider';

describe('DashScopeSpeechRecognitionProvider', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    key: process.env.DASHSCOPE_API_KEY,
    baseUrl: process.env.DASHSCOPE_BASE_URL,
    model: process.env.DASHSCOPE_ASR_MODEL,
  };

  beforeEach(() => {
    process.env.DASHSCOPE_API_KEY = 'test-key';
    process.env.DASHSCOPE_BASE_URL = 'https://workspace.example.com';
    process.env.DASHSCOPE_ASR_MODEL = 'paraformer-v2';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const [ key, value ] of Object.entries({
      DASHSCOPE_API_KEY: originalEnv.key,
      DASHSCOPE_BASE_URL: originalEnv.baseUrl,
      DASHSCOPE_ASR_MODEL: originalEnv.model,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('submits the configured model as an asynchronous English file-recognition task', async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    globalThis.fetch = async (input, init) => {
      request = { url: String(input), init };
      return new Response(JSON.stringify({ output: { task_id: 'task-1' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    };

    assert.deepEqual(await new DashScopeSpeechRecognitionProvider().submit({
      audioUrl: 'https://audio.example.com/recording.webm',
    }), { taskId: 'task-1' });
    assert.equal(request?.url,
      'https://workspace.example.com/api/v1/services/audio/asr/transcription');
    assert.equal((request?.init?.headers as Record<string, string>)['X-DashScope-Async'], 'enable');
    const body = JSON.parse(String(request?.init?.body));
    assert.equal(body.model, 'paraformer-v2');
    assert.deepEqual(body.parameters.language_hints, [ 'en' ]);
  });

  it('polls a successful task and reads its transcript result', async () => {
    const requests: string[] = [];
    globalThis.fetch = async input => {
      requests.push(String(input));
      if (requests.length === 1) {
        return new Response(JSON.stringify({ output: {
          task_status: 'SUCCEEDED',
          results: [{ transcription_url: 'https://result.example.com/transcript.json' }],
        } }), { status: 200 });
      }
      return new Response(JSON.stringify({
        transcripts: [{ text: 'Hello' }, { text: 'there.' }],
        properties: { original_duration_in_milliseconds: 900 },
      }), { status: 200 });
    };

    assert.deepEqual(await new DashScopeSpeechRecognitionProvider().poll('task-1'), {
      status: 'completed', transcript: 'Hello there.', durationMs: 900,
    });
  });
});
