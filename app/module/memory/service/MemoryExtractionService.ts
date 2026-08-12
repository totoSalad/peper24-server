import { AccessLevel, Inject, SingletonProto } from '@eggjs/tegg';
import { ProductAIService } from '../../ai/service/ProductAIService';
import { Clock } from '../../system/service/SystemPorts';
import { admitMemoryDecision } from './MemoryAdmissionPolicy';
import { MemoryRecord, MemoryRepository, PendingMemoryGroup } from './MemoryPorts';
import { MemoryService } from './MemoryService';

const MINIMUM_MESSAGES = 10;
const MAXIMUM_MESSAGES_PER_GROUP = 20;
const MAXIMUM_GROUPS = 20;

@SingletonProto({ accessLevel: AccessLevel.PUBLIC })
export class MemoryExtractionService {
  constructor(
    @Inject('MemoryRepository') private readonly memories: MemoryRepository,
    @Inject() private readonly memoryService: MemoryService,
    @Inject('ProductAIService') private readonly ai: ProductAIService,
    @Inject('Clock') private readonly clock: Clock,
  ) {}

  async processPendingForUser(userId: string, signal?: AbortSignal) {
    const groups = await this.memories.loadPendingMemoryGroups({
      userId,
      minimumMessages: MINIMUM_MESSAGES,
      maximumMessagesPerGroup: MAXIMUM_MESSAGES_PER_GROUP,
      maximumGroups: MAXIMUM_GROUPS,
    });
    const changed: MemoryRecord[] = [];
    for (const group of groups) changed.push(...await this.processGroup(group, signal));
    return changed;
  }

  private async processGroup(group: PendingMemoryGroup, signal?: AbortSignal) {
    const { userId, conversationId, targetMessages } = group;
    const targetIds = new Set(targetMessages.map(item => item.id));
    const messages = await this.memories.loadExtractionContext(
      conversationId, userId, targetMessages,
    );
    const result = await this.ai.extractMemories({
      targetMessageIds: [ ...targetIds ],
      messages: messages.map(item => ({ id: item.id, role: item.role, content: item.content })),
      existingMemories: await this.memoryService.listForExtraction(userId),
      signal,
    });
    const candidates = result.decisions
      .map(decision => admitMemoryDecision(decision, messages, targetIds))
      .filter(candidate => candidate !== null);
    const changed = await this.memoryService.applyCandidates(userId, candidates);
    await this.memories.markMessagesScanned(userId, [ ...targetIds ], this.clock.now());
    return changed;
  }
}
