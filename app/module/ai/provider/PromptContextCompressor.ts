import type { Logger } from '@eggjs/tegg';
import type { LanguageModel } from 'ai';
import { buildFoldSummaryPrompt } from '../prompt/FoldSummaryPrompt';
import type { FoldSummaryInput } from '../service/ProductAIService';
import { generateTextWithRetry } from './AISDKTextGenerator';

export interface PromptMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompressedPrompt {
  messages: PromptMessage[];
  /** 被折叠（移出窗口）的消息条数。 */
  folded: number;
  /** 是否发生了压缩（单条裁剪或折叠）。 */
  compressed: boolean;
  /** 压缩后的 running summary：折叠成功时为新摘要，否则沿用 previousSummary。 */
  summary?: string;
  /** summary 覆盖的前缀消息条数（折叠成功时推进到新边界，失败则维持原值）。 */
  summaryFoldedUntil: number;
  /** 被折叠的消息（已按单条阈值裁剪），供调试与测试。 */
  foldedMessages: PromptMessage[];
}

export interface CompressContext {
  topic?: string;
  previousSummary?: string;
  summaryFoldedUntil?: number;
  signal?: AbortSignal;
}

export interface PromptContextCompressorOptions {
  /** 消息窗口软预算：消息 token 超过则按条数收缩到 maxMessages。 */
  softBudgetTokens: number;
  /** 硬上限：收缩后仍超过则最旧优先继续折叠。 */
  hardCapTokens: number;
  /** 软预算收缩后的窗口大小（只留最近 ~30 条原文）。 */
  maxMessages: number;
  /** 单条消息 token 上限：超过则裁剪该条内容（保留前 60% + 后 40%，丢中间）。 */
  maxMessageTokens: number;
  /** 摘要 LLM 依赖。 */
  model: LanguageModel;
  logger?: Logger;
}

// Rough heuristic: CJK characters cost ~1 token each, everything else ~4 chars
// per token. Only used to bound the context window, never for billing.
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/g;
const CJK_CHAR_RE = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/;
const TRIM_SEPARATOR = ' … ';

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjkCount = text.match(CJK_RE)?.length ?? 0;
  return Math.ceil(cjkCount + (text.length - cjkCount) / 4);
}

/** 与 estimateTokens 对齐的单字符代价：CJK 1 token，其余 1/4。 */
function charTokenCost(char: string): number {
  return CJK_CHAR_RE.test(char) ? 1 : 0.25;
}

/**
 * 单条消息超阈值裁剪：保留开头 60%×maxTokens + 结尾 40%×maxTokens，中间丢弃。
 * 纯内存变换，不修改原始消息。
 */
function trimContentToTokens(content: string, maxTokens: number): string {
  const chars = Array.from(content);
  const frontTokens = maxTokens * 0.6;
  const backTokens = maxTokens * 0.4;

  let frontEnd = 0;
  let frontCost = 0;
  for (let index = 0; index < chars.length; index += 1) {
    const cost = charTokenCost(chars[index]);
    if (frontCost + cost > frontTokens) break;
    frontCost += cost;
    frontEnd = index + 1;
  }

  let backStart = chars.length;
  let backCost = 0;
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    const cost = charTokenCost(chars[index]);
    if (backCost + cost > backTokens) break;
    backCost += cost;
    backStart = index;
  }

  if (frontEnd >= backStart) return content;
  return `${chars.slice(0, frontEnd).join('')}${TRIM_SEPARATOR}${chars.slice(backStart).join('')}`;
}

/**
 * 裁剪位置 cut 合法 ⟺ 切在一个完整对话单元之前。
 * 一个单元 = 一条 assistant 消息 + 其后连续的所有 user 消息（网络抖动可能让
 * 一条 assistant 后跟多条 user，如 a1,u1,u2，必须整体保留）；末尾单独一条
 * assistant 自成一轮。assistant 必然先于 user 发起对话，所以只有 assistant
 * 之前（新单元起点）可裁剪，切在 user 中间会把对话拆开。
 * cut = 0 或 cut = length（全部折叠）恒合法。
 */
function isValidCut(messages: PromptMessage[], cut: number): boolean {
  if (cut === 0 || cut === messages.length) return true;
  return messages[cut].role === 'assistant';
}

/** 第一个 ≥ minCut 的合法裁剪位（保证存在：cut = length 恒合法）。 */
function smallestValidCutAtLeast(messages: PromptMessage[], minCut: number): number {
  for (let cut = Math.max(0, minCut); cut <= messages.length; cut += 1) {
    if (isValidCut(messages, cut)) return cut;
  }
  return messages.length;
}

/** after 之后的下一个合法裁剪位，无则 null。 */
function nextValidCut(messages: PromptMessage[], after: number): number | null {
  for (let cut = after + 1; cut <= messages.length; cut += 1) {
    if (isValidCut(messages, cut)) return cut;
  }
  return null;
}

/**
 * 压缩消息窗口（对齐 Prompt架构.md 的压缩流程）。
 *
 * 折叠原则：
 * - 单条超阈值消息先按阈值裁剪（保留前 60% + 后 40%，丢中间）；
 * - 超过软预算后按条数收缩，但只在完整对话边界裁剪，最多保留 maxMessages 条；
 * - 收缩后仍超硬上限，则沿边界继续折叠，直到只剩当前用户消息所在的完整对话单元；
 * - 被折叠的消息交给 LLM 提取含义（running summary）增量更新，结果随 compress
 *   一起返回；摘要失败降级为 previousSummary，边界不推进。
 *
 * 裁剪与折叠为纯函数运算；摘要由本类通过注入的 model/logger 发起（内部方法）。
 */
export class PromptContextCompressor {
  private readonly softBudgetTokens: number;
  private readonly hardCapTokens: number;
  private readonly maxMessages: number;
  private readonly maxMessageTokens: number;
  private readonly model: LanguageModel;
  private readonly logger?: Logger;

  constructor(options: PromptContextCompressorOptions) {
    this.softBudgetTokens = options.softBudgetTokens;
    this.hardCapTokens = options.hardCapTokens;
    this.maxMessages = options.maxMessages;
    this.maxMessageTokens = options.maxMessageTokens;
    this.model = options.model;
    this.logger = options.logger;
  }

  estimateMessages(messages: PromptMessage[]): number {
    return messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
  }

  /** 把被折叠的消息压缩成 running summary（纯文本，2-3 句）。 */
  private async summarizeFolded(input: FoldSummaryInput): Promise<string> {
    const result = await generateTextWithRetry({
      model: this.model,
      logger: this.logger,
      label: 'summarizeFolded',
      prompt: buildFoldSummaryPrompt(input),
      abortSignal: input.signal,
    });
    const summary = result.text.trim();
    if (!summary) throw new Error('AI returned an empty folded summary');
    return summary;
  }

  private handleSummarizeError(error: unknown): void {
    this.logger?.warn(
      '[ai-context] summarize folded failed err=%s',
      error instanceof Error ? error.message : String(error),
    );
  }

  async compress(
    messages: PromptMessage[],
    context: CompressContext = {},
  ): Promise<CompressedPrompt> {
    // Stage 0：单条超阈值裁剪（纯内存副本，不改 DB）。
    let trimmed = false;
    const window = messages.map(message => {
      if (estimateTokens(message.content) > this.maxMessageTokens) {
        trimmed = true;
        return { ...message, content: trimContentToTokens(message.content, this.maxMessageTokens) };
      }
      return message;
    });

    const baseFoldedUntil = context.summaryFoldedUntil ?? 0;

    // 单条消息（当前用户消息）永不折叠。
    if (window.length <= 1 || this.estimateMessages(window) <= this.softBudgetTokens) {
      return {
        messages: window,
        folded: 0,
        compressed: trimmed,
        summary: context.previousSummary,
        summaryFoldedUntil: baseFoldedUntil,
        foldedMessages: [],
      };
    }

    // Stage 2：超过软预算 → 按完整对话边界收缩，只留最近 ≤ maxMessages 条。
    let cut = smallestValidCutAtLeast(window, window.length - this.maxMessages);
    let kept = window.slice(cut);

    // Stage 3：收缩后仍超硬上限 → 沿边界继续折叠，直到只剩当前用户消息所在的完整单元。
    while (this.estimateMessages(kept) > this.hardCapTokens) {
      const nextCut = nextValidCut(window, cut);
      // 当前用户消息永不折叠：不推进到会把它也清出窗口的位置。
      if (nextCut === null || nextCut >= window.length) break;
      cut = nextCut;
      kept = window.slice(cut);
    }

    const foldedMessages = window.slice(0, cut);

    // 折叠发生时把新折叠段交给 LLM 提取含义，running summary 增量更新。
    let summary = context.previousSummary;
    let summaryFoldedUntil = baseFoldedUntil;
    const newlyFolded = foldedMessages.slice(Math.min(cut, baseFoldedUntil));
    if (newlyFolded.length > 0) {
      try {
        summary = await this.summarizeFolded({
          topic: context.topic,
          previousSummary: context.previousSummary,
          messages: newlyFolded,
          signal: context.signal,
        });
        summaryFoldedUntil = cut;
      } catch (error) {
        this.handleSummarizeError(error);
        summary = context.previousSummary;
      }
    }

    return {
      messages: kept,
      folded: cut,
      compressed: true,
      summary,
      summaryFoldedUntil,
      foldedMessages,
    };
  }
}
