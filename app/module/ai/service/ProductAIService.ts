export interface AIUsage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface Correction {
  errorType: GrammarErrorType;
  original: string;
  corrected: string;
  note: string;
}

export const grammarErrorTypes = [
  'subject_verb_agreement',
  'tense',
  'article',
  'singular_plural',
  'countable_uncountable',
  'preposition_collocation',
  'adjective_adverb',
  'comparative',
  'pronoun',
  'infinitive_gerund',
  'modal_verb_form',
  'double_negative',
  'sentence_fragment',
  'chinese_word_order',
  'there_be_have',
  'duplicate_conjunction',
] as const;

export type GrammarErrorType = typeof grammarErrorTypes[number];

export interface GrammarAnalysis {
  explicitGrammarQuestion: boolean;
  errors: Correction[];
}

export interface GrammarAnalysisInput {
  content: string;
  learner?: LearnerContext;
  signal?: AbortSignal;
}

export interface VocabularyEnrichmentInput {
  text: string;
  context: string;
  learner?: LearnerContext;
  signal?: AbortSignal;
}

export interface VocabularyEnrichment {
  cnMeaning: string;
  enMeaning: string;
  example: string;
  phonetic: string;
}

export interface TranslationInput {
  content: string;
  targetLanguage: 'Chinese' | 'English';
  signal?: AbortSignal;
}

export interface TranslationResult {
  translation: string;
}

export interface DailyLearningSummaryInput {
  date: string;
  timezone: string;
  metrics: {
    conversationCount: number;
    userMessageCount: number;
    chatTokens: number;
    grammarErrorCount: number;
    grammar: Array<{
      errorType: GrammarErrorType;
      count: number;
      examples: Correction[];
    }>;
    newVocabularyCount: number;
    newVocabulary: string[];
    reviewedCount: number;
    reviewResults: Record<'again' | 'hard' | 'good' | 'easy', number>;
  };
  signal?: AbortSignal;
}

export interface DailyLearningSummaryContent {
  headline: string;
  highlights: string[];
  improvements: string[];
  nextSteps: string[];
}

export interface DailyLearningSummaryGeneration {
  content: DailyLearningSummaryContent;
  usage: AIUsage;
}

export type AIMemoryType = 'profile' | 'preference' | 'significant_fact' | 'short_term';

export interface LearnerMemory {
  type: AIMemoryType;
  content: string;
}

export interface ExistingMemory {
  type: AIMemoryType;
  content: string;
  summary: string;
  normalizedKey: string;
}

export interface MemoryExtractionInput {
  /** Only these unscanned user messages may be cited as memory sources. */
  targetMessageIds: string[];
  messages: Array<{ id: string; role: 'user' | 'assistant'; content: string }>;
  existingMemories: ExistingMemory[];
  signal?: AbortSignal;
}

export type MemoryScore = 0 | 1 | 2;
export type MemoryPenalty = 'current_context_only' | 'too_granular' | 'one_off_event';

export type MemoryNoSaveDecision = { shouldSave: false; reason: string };

export type MemorySaveDecision = {
  shouldSave: true;
  layer: 'short_term' | 'long_term';
  type: AIMemoryType;
  summary: string;
  normalizedKey: string;
  sourceMessageIds: string[];
  scores: {
    stability: MemoryScore;
    futureValue: MemoryScore;
    personalImportance: MemoryScore;
    explicitness: MemoryScore;
  };
  penalties: MemoryPenalty[];
  explicitRemember: boolean;
  inferredOrHypothetical: boolean;
  containsSecret: boolean;
  temporaryDays?: 7 | 14 | 30;
  reason: string;
};

export type MemoryAdmissionDecision = MemoryNoSaveDecision | MemorySaveDecision;

export type MemoryExtractionResult = {
  decisions: [MemoryNoSaveDecision] | [MemorySaveDecision] | [MemorySaveDecision, MemorySaveDecision];
};

export type CEFRLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export interface LearnerContext {
  displayName?: string;
  age?: number;
  occupation?: string;
  englishLevel: CEFRLevel;
  memories?: LearnerMemory[];
}

/** 第⑥层「会话状态」数据源（conversations.summary_json 的注入视图）。 */
export interface ConversationState {
  /** 会话一句话总结（语义压缩，惰性刷新）。 */
  oneLiner?: string;
}

export type ChatEvent =
  | { type: 'message.start'; messageId: string }
  | { type: 'message.delta'; messageId: string; delta: string }
  | { type: 'tool.call'; toolCallId: string; name: string; input: unknown }
  | { type: 'tool.result'; toolCallId: string; output: unknown }
  | { type: 'correction.ready'; messageId: string; correction: Correction }
  | { type: 'summary.update'; summary: string; foldedUntil: number }
  | { type: 'message.done'; messageId: string; usage: AIUsage }
  | { type: 'error'; code: string; retryable: boolean; message?: string };

export interface WelcomeInput {
  userId: string;
  topic: string;
  scene?: string;
  learner?: LearnerContext;
}

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatInput {
  messageId: string;
  userId: string;
  conversationId: string;
  topic: string;
  scene?: string;
  history: ChatHistoryMessage[];
  content: string;
  learner?: LearnerContext;
  conversationState?: ConversationState;
  /** 已持久化的折叠消息运行摘要（未折叠轮直接注入系统 prompt）。 */
  summary?: string;
  /** 运行摘要已覆盖的消息条数（折叠边界，用于增量总结新折叠段）。 */
  summaryFoldedUntil?: number;
  signal?: AbortSignal;
}

export interface FoldSummaryInput {
  topic?: string;
  previousSummary?: string;
  messages: ChatHistoryMessage[];
  signal?: AbortSignal;
}

export abstract class ProductAIService {
  abstract createWelcome(input: WelcomeInput): Promise<string>;
  abstract chat(input: ChatInput): AsyncIterable<ChatEvent>;
  abstract analyzeGrammar(input: GrammarAnalysisInput): Promise<GrammarAnalysis>;
  abstract enrichVocabulary(input: VocabularyEnrichmentInput): Promise<VocabularyEnrichment | null>;
  abstract translate(input: TranslationInput): Promise<TranslationResult>;
  abstract generateDailyLearningSummary(
    input: DailyLearningSummaryInput,
  ): Promise<DailyLearningSummaryGeneration>;
  abstract extractMemories(input: MemoryExtractionInput): Promise<MemoryExtractionResult>;
}
