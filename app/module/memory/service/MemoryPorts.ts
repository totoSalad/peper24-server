export const memoryTypes = [ 'profile', 'preference', 'significant_fact', 'short_term' ] as const;
export type MemoryType = typeof memoryTypes[number];
export type MemoryStatus = 'active' | 'deleted' | 'superseded';

export interface MemoryCandidate {
  type: MemoryType;
  content: string;
  summary: string;
  normalizedKey: string;
  confidence: number;
  admissionScore: number;
  explicitlyRequested: boolean;
  admissionReason: string;
  assessmentJson: string;
  temporaryDays?: 7 | 14 | 30;
  sourceMessageIds: string[];
}

export interface MemoryRecord {
  id: string;
  userId: string;
  type: MemoryType;
  content: string;
  summary: string;
  normalizedKey: string;
  confidence: number;
  admissionScore: number;
  explicitlyRequested: boolean;
  admissionReason: string;
  assessmentJson: string;
  status: MemoryStatus;
  expiresAt?: Date;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemorySourceMessage {
  id: string;
  conversationId: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  sequence: number;
  createdAt: Date;
}

export interface ApplyMemoryCandidatesInput {
  userId: string;
  candidates: MemoryCandidate[];
  now: Date;
  create(candidate: MemoryCandidate): MemoryRecord;
  expiryFor(candidate: MemoryCandidate): Date | undefined;
  limitFor(type: MemoryType): number | undefined;
  longTermLimit: number;
}

export interface PendingMemoryGroup {
  userId: string;
  conversationId: string;
  targetMessages: MemorySourceMessage[];
}

export abstract class MemoryRepository {
  abstract list(userId: string, now: Date): Promise<MemoryRecord[]>;
  abstract update(
    userId: string,
    id: string,
    content: string,
    summary: string,
    now: Date,
  ): Promise<MemoryRecord | null>;
  abstract delete(userId: string, id: string, now: Date): Promise<boolean>;
  abstract loadPendingMemoryGroups(input: {
    userId: string;
    minimumMessages: number;
    maximumMessagesPerGroup: number;
    maximumGroups: number;
  }): Promise<PendingMemoryGroup[]>;
  abstract loadExtractionContext(
    conversationId: string,
    userId: string,
    targetMessages: MemorySourceMessage[],
  ): Promise<MemorySourceMessage[]>;
  abstract markMessagesScanned(
    userId: string,
    messageIds: string[],
    scannedAt: Date,
  ): Promise<void>;
  abstract applyCandidates(input: ApplyMemoryCandidatesInput): Promise<MemoryRecord[]>;
}
