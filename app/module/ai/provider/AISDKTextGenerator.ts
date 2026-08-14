import type { Logger } from '@eggjs/tegg';
import {
  APICallError,
  generateText,
  NoObjectGeneratedError,
  Output,
} from 'ai';
import type { InferGenerateOutput, LanguageModel } from 'ai';

const MAX_RETRIES = 2;
const INITIAL_RETRY_DELAY_MS = 1000;
// When the provider answers Retry-After, that value is the minimum wait before
// retrying. If it exceeds this cap, retrying is pointless and we fail fast.
const MAX_RETRY_AFTER_MS = 5000;
const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  'ENOTFOUND',
]);

interface GenerateTextWithRetryOptions<OUTPUT extends Output.Output> {
  model: LanguageModel;
  system?: string;
  prompt: string;
  output?: OUTPUT;
  reasoning?: 'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  abortSignal?: AbortSignal;
  /** aiLogger to emit start/done lifecycle logs. Optional so tests can omit it. */
  logger?: Logger;
  /** Human-readable label for the log lines, e.g. 'analyzeGrammar'. */
  label?: string;
}

interface GenerateTextWithRetryResult<OUTPUT extends Output.Output> {
  readonly text: string;
  readonly output: InferGenerateOutput<OUTPUT>;
  readonly usage: { inputTokens: number; outputTokens: number };
}

/**
 * Calls AI SDK generateText with one retry policy shared by all product AI use cases.
 * The SDK retry loop is disabled so transient-error classification and abort handling
 * remain consistent across providers.
 */
export async function generateTextWithRetry<
  OUTPUT extends Output.Output = Output.Output<string, string>
>(
  options: GenerateTextWithRetryOptions<OUTPUT>,
): Promise<GenerateTextWithRetryResult<OUTPUT>> {
  const { logger, label, ...generateOptions } = options;
  const name = label ?? 'generateText';

  logger?.info('[ai-generate] %s start', name);
  const result = await retryTransientFailure(
    () => generateTextOnce(generateOptions, logger, name),
    generateOptions.abortSignal,
  );
  const inputTokens = result.usage.inputTokens ?? 0;
  const outputTokens = result.usage.outputTokens ?? 0;
  logger?.info(
    '[ai-generate] %s done inputTokens=%d outputTokens=%d totalTokens=%d',
    name, inputTokens, outputTokens, inputTokens + outputTokens,
  );
  return { text: result.text, output: result.output, usage: { inputTokens, outputTokens } };
}

/**
 * Runs one generateText attempt with SDK-level retries disabled (the outer
 * retry policy owns transient errors). Some providers (e.g. DeepSeek) only
 * support JSON Schema in a compatibility mode where the schema is injected
 * into the system prompt, so the model can emit JSON that fails to parse or
 * validate, surfacing as NoObjectGeneratedError. When that happens, retry ONCE
 * with the failure appended so the model can repair its own output.
 */
async function generateTextOnce<
  OUTPUT extends Output.Output = Output.Output<string, string>
>(
  options: Omit<GenerateTextWithRetryOptions<OUTPUT>, 'logger' | 'label'>,
  logger?: Logger,
  name = 'generateText',
) {
  const { prompt, output, ...generateOptions } = options;
  try {
    return await generateText({
      ...generateOptions,
      prompt,
      output,
      maxRetries: 0,
    });
  } catch (error) {
    if (!output || !NoObjectGeneratedError.isInstance(error)) throw error;
    logger?.warn(
      '[ai-generate] %s structured output failed, retrying with repair prompt: %s',
      name,
      error.message,
    );
    return await generateText({
      ...generateOptions,
      prompt: `${prompt}\n\n${buildRepairPrompt(error)}`,
      output,
      maxRetries: 0,
    });
  }
}

function buildRepairPrompt(error: NoObjectGeneratedError): string {
  return [
    'Your previous response could not be parsed as the required JSON object:',
    error.message ?? '',
    'Return ONLY a valid JSON object that satisfies the schema exactly.',
    'No markdown, no code fences, no extra prose.',
  ].join('\n');
}

async function retryTransientFailure<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (signal?.aborted || isAbortError(error) || !isRetryableError(error)) throw error;
      lastError = error;
      if (attempt === MAX_RETRIES) break;

      const retryAfterMs = retryAfterFromError(error);
      if (retryAfterMs !== undefined && retryAfterMs > MAX_RETRY_AFTER_MS) throw error;
      await sleep(Math.max(computeRetryDelay(attempt + 1), retryAfterMs ?? 0), signal);
    }
  }

  throw lastError;
}

function isRetryableError(error: unknown): boolean {
  const errno = error instanceof Error ? error as NodeJS.ErrnoException : undefined;
  if (errno?.code && NETWORK_ERROR_CODES.has(errno.code)) return true;
  if (!APICallError.isInstance(error)) return false;
  if (error.isRetryable) return true;

  // Some providers leave isRetryable undefined, so retain an HTTP fallback.
  const status = error.statusCode;
  return status === 408 || status === 429 || (status !== undefined && status >= 500);
}

// Reads the Retry-After header (RFC 9110). It is either a delay-seconds integer
// or an HTTP date; responseHeaders keys are lowercased by the Fetch Headers
// iterator. Returns the minimum wait in ms, or undefined when absent/unparsable.
function retryAfterFromError(error: unknown): number | undefined {
  if (!APICallError.isInstance(error)) return undefined;

  const header = error.responseHeaders?.['retry-after'];
  if (!header) return undefined;

  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;

  const at = Date.parse(trimmed);
  if (Number.isFinite(at)) return Math.max(0, at - Date.now());

  return undefined;
}

function isAbortError(error: unknown): boolean {
  return (error instanceof Error || error instanceof DOMException)
    && (error.name === 'AbortError' || error.name === 'ResponseAborted' || error.name === 'TimeoutError');
}

function computeRetryDelay(retry: number): number {
  const exponential = INITIAL_RETRY_DELAY_MS * 2 ** (retry - 1);
  return Math.floor(exponential * (0.5 + Math.random() * 0.5));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(createAbortError());

  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      reject(createAbortError());
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
  });
}

function createAbortError(): DOMException {
  return new DOMException('Request aborted', 'AbortError');
}
