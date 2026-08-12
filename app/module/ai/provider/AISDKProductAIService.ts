import { Output, stepCountIs, streamText, tool } from 'ai';
import { AccessLevel, Inject, Logger, SingletonProto } from '@eggjs/tegg';
import { z } from 'zod';
import { buildConversationSystemPrompt } from '../prompt/ConversationPrompt';
import { buildGrammarAnalysisPrompt } from '../prompt/GrammarAnalysisPrompt';
import { buildVocabularyEnrichmentPrompt } from '../prompt/VocabularyEnrichmentPrompt';
import { buildTranslationPrompt } from '../prompt/TranslationPrompt';
import { buildMemoryExtractionPrompt } from '../prompt/MemoryExtractionPrompt';
import { buildDailyLearningSummaryPrompt } from '../prompt/DailyLearningSummaryPrompt';
import { GrammarAnalysisSchema } from '../schema/GrammarAnalysisSchema';
import { VocabularyEnrichmentSchema } from '../schema/VocabularyEnrichmentSchema';
import { TranslationOutputSchema } from '../schema/TranslationSchema';
import { MemoryExtractionSchema } from '../schema/MemoryExtractionSchema';
import { DailyLearningSummarySchema } from '../schema/DailyLearningSummarySchema';
import {
  ChatEvent,
  ChatInput,
  ExplainedExpressionResult,
  DailyLearningSummaryGeneration,
  DailyLearningSummaryInput,
  GrammarAnalysis,
  GrammarAnalysisInput,
  MemoryExtractionInput,
  MemoryExtractionResult,
  ProductAIService,
  TranslationInput,
  TranslationResult,
  VocabularyEnrichment,
  VocabularyEnrichmentInput,
  WelcomeInput,
} from '../service/ProductAIService';
import { generateTextWithRetry } from './AISDKTextGenerator';
import { DevelopmentProductAIService } from './DevelopmentProductAIService';
import { PromptContextCompressor, PromptMessage } from './PromptContextCompressor';
import { TextModelProvider } from './TextModelProvider';

// 消息窗口压缩预算（对齐 Prompt架构.md；均为常量，方便后续调整）。
// 超过软预算则按完整对话边界收缩，只留最近 ~30 条；仍超硬上限则沿边界继续折叠，
// 直到只剩当前用户消息所在的完整对话单元。单条超过阈值则按前 60% + 后 40% 裁剪。
const CHAT_SOFT_BUDGET_TOKENS = 12_000;
const CHAT_HARD_CAP_TOKENS = 8_000;
const CHAT_WINDOW_MAX_MESSAGES = 30;
const CHAT_MESSAGE_MAX_TOKENS = 2_000;

@SingletonProto({ name: 'ProductAIService', accessLevel: AccessLevel.PUBLIC })
export class AISDKProductAIService extends ProductAIService {
  private readonly development = new DevelopmentProductAIService();

  constructor(
    @Inject('TextModelProvider') private readonly models: TextModelProvider,
    @Inject('aiLogger') private readonly aiLogger: Logger,
  ) {
    super();
  }

  async createWelcome(input: WelcomeInput): Promise<string> {
    const resolved = this.models.resolve();
    if (!resolved) return this.development.createWelcome(input);

    const result = await generateTextWithRetry({
      model: resolved.model,
      logger: this.aiLogger,
      label: 'createWelcome',
      system: buildConversationSystemPrompt({
        topic: input.topic,
        scene: input.scene,
        learner: input.learner,
      }),
      prompt: 'Start this conversation with one brief, welcoming question in English.',
    });
    const welcome = result.text.trim();
    if (!welcome) throw new Error('AI returned an empty welcome message');
    return welcome;
  }

  async* chat(input: ChatInput): AsyncIterable<ChatEvent> {
    const resolved = this.models.resolve();
    if (!resolved) {
      yield* this.development.chat(input);
      return;
    }

    yield { type: 'message.start', messageId: input.messageId };

    const automaticallyExplained: ExplainedExpressionResult[] = [];
    const automaticallyExplainedByText = new Map<string, ExplainedExpressionResult>();
    for (const [ index, text ] of (input.requiredExpressions ?? []).entries()) {
      if (!input.tools) break;
      const toolCallId = `auto-explain-${input.messageId}-${index + 1}`;
      const value = { text, context: input.content };
      try {
        const explained = await input.tools.explainExpression(value);
        if (!explained) continue;
        automaticallyExplained.push(explained);
        automaticallyExplainedByText.set(text.normalize('NFKC').trim().toLocaleLowerCase('en-US'), explained);
        yield { type: 'tool.call', toolCallId, name: 'explain_expression', input: value };
        yield { type: 'tool.result', toolCallId, output: explained };
      } catch (error) {
        this.aiLogger.warn(
          '[ai-tool] automatic explain_expression failed messageId=%s input=%j err=%s',
          input.messageId, value, error instanceof Error ? error.message : String(error),
        );
        yield {
          type: 'tool.result', toolCallId,
          output: { ok: false, error: { code: 'EXPRESSION_EXPLANATION_FAILED' } },
        };
      }
    }

    const messages: PromptMessage[] = [
      ...input.history,
      { role: 'user', content: input.content },
    ];
    // 压缩并增量总结被折叠的消息：compress 内部完成 裁剪→折叠→LLM 摘要，
    // 返回压缩后的窗口、running summary 与压缩标志。
    const compressed = await new PromptContextCompressor({
      softBudgetTokens: CHAT_SOFT_BUDGET_TOKENS,
      hardCapTokens: CHAT_HARD_CAP_TOKENS,
      maxMessages: CHAT_WINDOW_MAX_MESSAGES,
      maxMessageTokens: CHAT_MESSAGE_MAX_TOKENS,
      model: resolved.model,
      logger: this.aiLogger,
    }).compress(messages, {
      topic: input.topic,
      previousSummary: input.summary,
      summaryFoldedUntil: input.summaryFoldedUntil,
      signal: input.signal,
    });

    const { messages: chatMessages, folded, summary } = compressed;
    if (folded > 0) {
      this.aiLogger.info(
        '[ai-context] folded=%d messages messageId=%s',
        folded, input.messageId,
      );
    }
    // 摘要边界推进说明产生了新摘要，交给调用方持久化。
    if (compressed.summaryFoldedUntil > (input.summaryFoldedUntil ?? 0)) {
      yield { type: 'summary.update', summary: summary ?? '', foldedUntil: compressed.summaryFoldedUntil };
    }

    const result = streamText({
      model: resolved.model,
      system: [ buildConversationSystemPrompt({
        topic: input.topic,
        scene: input.scene,
        learner: input.learner,
        conversationState: input.conversationState,
        summary,
      }), automaticallyExplained.length ? [
        '[Automatically explained expressions: trusted tool results]',
        'These expressions were already explained and saved before this reply. Use their English expression naturally and do not call explain_expression for them again.',
        JSON.stringify(automaticallyExplained),
      ].join('\n') : '' ].filter(Boolean).join('\n\n'),
      messages: chatMessages,
      abortSignal: input.signal,
      tools: input.tools ? {
        explain_expression: tool({
          description: 'Explain and save a word or short expression to the learner\'s vocabulary book. `text` may be an English expression or the exact Chinese fragment the learner used; `context` contains the source sentence.',
          inputSchema: z.object({
            text: z.string().trim().min(1)
              .max(500),
            context: z.string().trim().max(2000),
          }),
          execute: async value => {
            const startedAt = Date.now();
            try {
              const cached = automaticallyExplainedByText.get(
                value.text.normalize('NFKC').trim().toLocaleLowerCase('en-US'),
              );
              if (cached) return cached;
              const result = await input.tools?.explainExpression(value);
              this.aiLogger.info(
                '[ai-tool] explain_expression ok messageId=%s ms=%d input=%j',
                input.messageId, Date.now() - startedAt, value,
              );
              return result;
            } catch (error) {
              this.aiLogger.warn(
                '[ai-tool] explain_expression failed messageId=%s ms=%d input=%j err=%s',
                input.messageId, Date.now() - startedAt, value,
                error instanceof Error ? error.message : String(error),
              );
              return { ok: false, error: { code: 'EXPRESSION_EXPLANATION_FAILED' } };
            }
          },
        }),
      } : undefined,
      stopWhen: input.tools ? stepCountIs(4) : undefined,
    });
    let finished = false;
    const pendingToolCalls = new Map<string, Extract<ChatEvent, { type: 'tool.call' }>>();
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        yield { type: 'message.delta', messageId: input.messageId, delta: part.text };
      } else if (part.type === 'tool-call') {
        pendingToolCalls.set(part.toolCallId, {
          type: 'tool.call',
          toolCallId: part.toolCallId,
          name: part.toolName,
          input: part.input,
        });
      } else if (part.type === 'tool-result') {
        const call = pendingToolCalls.get(part.toolCallId);
        pendingToolCalls.delete(part.toolCallId);
        if (part.output === null) continue;
        if (call) yield call;
        yield { type: 'tool.result', toolCallId: part.toolCallId, output: part.output };
      } else if (part.type === 'finish') {
        finished = true;
        yield {
          type: 'message.done',
          messageId: input.messageId,
          usage: {
            provider: resolved.provider,
            model: resolved.modelId,
            inputTokens: part.totalUsage.inputTokens ?? 0,
            outputTokens: part.totalUsage.outputTokens ?? 0,
          },
        };
      } else if (part.type === 'error') {
        throw part.error instanceof Error ? part.error : new Error('AI stream failed');
      } else if (part.type === 'abort') {
        throw new Error('AI stream aborted');
      }
    }

    if (!finished) throw new Error('AI stream ended without a finish event');
  }

  async analyzeGrammar(input: GrammarAnalysisInput): Promise<GrammarAnalysis> {
    const resolved = this.models.resolve();
    if (!resolved) return this.development.analyzeGrammar(input);

    const result = await generateTextWithRetry({
      model: resolved.model,
      logger: this.aiLogger,
      label: 'analyzeGrammar',
      output: Output.object({
        name: 'GrammarAnalysis',
        description: 'Fixed-taxonomy English grammar analysis for one learner message.',
        schema: GrammarAnalysisSchema,
      }),
      prompt: buildGrammarAnalysisPrompt(input),
      abortSignal: input.signal,
    });
    return result.output;
  }

  async enrichVocabulary(input: VocabularyEnrichmentInput): Promise<VocabularyEnrichment | null> {
    const resolved = this.models.resolve();
    if (!resolved) return this.development.enrichVocabulary(input);
    const result = await generateTextWithRetry({
      model: resolved.model,
      logger: this.aiLogger,
      label: 'enrichVocabulary',
      output: Output.object({
        name: 'VocabularyEnrichment',
        description: 'Canonical learning information for one English word or short phrase.',
        schema: VocabularyEnrichmentSchema,
      }),
      prompt: buildVocabularyEnrichmentPrompt(input),
      abortSignal: input.signal,
    });
    return Object.keys(result.output).length === 0
      ? null
      : result.output as VocabularyEnrichment;
  }

  async translate(input: TranslationInput): Promise<TranslationResult> {
    const resolved = this.models.resolve();
    if (!resolved) return this.development.translate(input);
    const result = await generateTextWithRetry({
      model: resolved.model,
      logger: this.aiLogger,
      label: 'translate',
      output: Output.object({
        name: 'MessageTranslation',
        description: 'A faithful translation of one chat message.',
        schema: TranslationOutputSchema,
      }),
      prompt: buildTranslationPrompt(input),
      abortSignal: input.signal,
    });
    return result.output;
  }

  async generateDailyLearningSummary(
    input: DailyLearningSummaryInput,
  ): Promise<DailyLearningSummaryGeneration> {
    const resolved = this.models.resolve();
    if (!resolved) return this.development.generateDailyLearningSummary(input);
    const result = await generateTextWithRetry({
      model: resolved.model,
      logger: this.aiLogger,
      label: 'generateDailyLearningSummary',
      output: Output.object({
        name: 'DailyLearningSummary',
        description: 'A concise daily English-learning report grounded in supplied metrics.',
        schema: DailyLearningSummarySchema,
      }),
      prompt: buildDailyLearningSummaryPrompt(input),
      abortSignal: input.signal,
    });
    return {
      content: result.output,
      usage: {
        provider: resolved.provider,
        model: resolved.modelId,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      },
    };
  }

  async extractMemories(input: MemoryExtractionInput): Promise<MemoryExtractionResult> {
    const resolved = this.models.resolve();
    if (!resolved) return this.development.extractMemories(input);
    const result = await generateTextWithRetry({
      model: resolved.model,
      logger: this.aiLogger,
      label: 'extractMemories',
      output: Output.object({
        name: 'MemoryAdmission',
        description: 'Up to two conservative final memory decisions grounded in source messages.',
        schema: MemoryExtractionSchema,
      }),
      prompt: buildMemoryExtractionPrompt(input),
      abortSignal: input.signal,
    });
    return result.output as MemoryExtractionResult;
  }
}
