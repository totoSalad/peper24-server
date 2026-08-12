import type { AIUsage, Correction, GrammarErrorType } from '../../ai/service/ProductAIService';

export const reviewResultNames = [ 'again', 'hard', 'good', 'easy' ] as const;
export type SummaryReviewResult = typeof reviewResultNames[number];

export interface DailyGrammarFeedback {
  errorType: GrammarErrorType;
  count: number;
  examples: Correction[];
}

export interface DailyLearningMetrics {
  conversationCount: number;
  userMessageCount: number;
  chatTokens: number;
  grammarErrorCount: number;
  grammar: DailyGrammarFeedback[];
  newVocabularyCount: number;
  newVocabulary: string[];
  reviewedCount: number;
  reviewResults: Record<SummaryReviewResult, number>;
}

export interface DailyLearningSummaryContent {
  headline: string;
  highlights: string[];
  improvements: string[];
  nextSteps: string[];
}

export type LearningSummaryStatus = 'generating' | 'completed' | 'failed';

export interface DailyLearningSummaryRecord {
  id: string;
  userId: string;
  summaryDate: string;
  timezone: string;
  status: LearningSummaryStatus;
  sourceVersion: string;
  metrics: DailyLearningMetrics;
  content?: DailyLearningSummaryContent;
  usage?: AIUsage;
  retryCount: number;
  generatedAt?: Date;
  finalizedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SummaryDateRange {
  date: string;
  from: Date;
  to: Date;
}

export abstract class LearningSummaryRepository {
  abstract aggregate(
    userId: string,
    range: SummaryDateRange,
  ): Promise<DailyLearningMetrics | null>;
  abstract find(userId: string, date: string): Promise<DailyLearningSummaryRecord | null>;
  abstract list(
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<DailyLearningSummaryRecord[]>;
  abstract claim(input: {
    id: string;
    userId: string;
    date: string;
    timezone: string;
    sourceVersion: string;
    metrics: DailyLearningMetrics;
    now: Date;
  }): Promise<boolean>;
  abstract complete(input: {
    userId: string;
    date: string;
    sourceVersion: string;
    content: DailyLearningSummaryContent;
    usage: AIUsage;
    now: Date;
  }): Promise<void>;
  abstract listRecentlyActiveUserIds(from: Date, to: Date): Promise<string[]>;
  abstract finalizeBefore(date: string, now: Date): Promise<void>;
}
