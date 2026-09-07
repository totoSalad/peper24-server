import type {
  MemoryCandidate,
  MemoryRecord,
  MemoryStatus,
  MemoryType,
} from '../service/MemoryPorts';

/**
 * 充血领域类：记忆的状态转换规则内聚在对象方法上。
 *
 * 与贫血版 `MemoryRecord`（纯数据）的区别：
 * - 字段私有只读，外部只能通过 getter 读取，不能直接改写 status/content；
 * - 生命周期与合并/复活/淘汰规则是对象自己的方法，而不是散落在 Service 或
 *   Repository 里的平铺判断；
 * - `fromRecord/toRecord` 与持久化层互转，Repository 只负责 SQL，不承载业务规则。
 *
 * 不变量（对齐 docs/memory.md）：
 * - content 保留首次来源原文，合并只更新 summary 与评分，永不覆盖 content；
 * - deleted 记忆仅在出现新来源时复活；superseded 记忆总是可复活；
 * - short_term 过期由上下文（expiryFor）决定，长期记忆不自动过期。
 */

export interface MemoryContext {
  now: Date;
  expiryFor(candidate: MemoryCandidate): Date | undefined;
}

export class Memory {
  private constructor(private readonly props: Readonly<MemoryRecord>) {}

  /** 从持久化记录恢复领域对象。 */
  static fromRecord(record: MemoryRecord): Memory {
    return new Memory({ ...record });
  }

  /** 从候选创建新记忆（status=active，过期时间由上下文决定）。 */
  static create(
    userId: string,
    id: string,
    candidate: MemoryCandidate,
    context: MemoryContext,
  ): Memory {
    return new Memory({
      id,
      userId,
      type: candidate.type,
      content: candidate.content.trim(),
      summary: candidate.summary.trim(),
      normalizedKey: candidate.normalizedKey,
      confidence: candidate.confidence,
      admissionScore: candidate.admissionScore,
      explicitlyRequested: candidate.explicitlyRequested,
      admissionReason: candidate.admissionReason,
      assessmentJson: candidate.assessmentJson,
      status: 'active',
      expiresAt: context.expiryFor(candidate),
      createdAt: context.now,
      updatedAt: context.now,
    });
  }

  get id(): string { return this.props.id; }
  get userId(): string { return this.props.userId; }
  get type(): MemoryType { return this.props.type; }
  get content(): string { return this.props.content; }
  get summary(): string { return this.props.summary; }
  get normalizedKey(): string { return this.props.normalizedKey; }
  get confidence(): number { return this.props.confidence; }
  get admissionScore(): number { return this.props.admissionScore; }
  get explicitlyRequested(): boolean { return this.props.explicitlyRequested; }
  get admissionReason(): string { return this.props.admissionReason; }
  get assessmentJson(): string { return this.props.assessmentJson; }
  get status(): MemoryStatus { return this.props.status; }
  get expiresAt(): Date | undefined { return this.props.expiresAt; }
  get deletedAt(): Date | undefined { return this.props.deletedAt; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  /** 活跃且未过期（status=active 且 expiresAt 未到）。 */
  isActiveAt(now: Date): boolean {
    return this.props.status === 'active'
      && (!this.props.expiresAt || this.props.expiresAt > now);
  }

  /**
   * 同 key 已存在（active）时的合并：
   * 保留 content（首次来源原文），只更新 summary 与评分。
   * summary 未变化时返回 null——调用方无需写库。
   */
  mergeWith(candidate: MemoryCandidate, context: MemoryContext): Memory | null {
    if (this.props.summary === candidate.summary) return null;
    return this.withProps({
      summary: candidate.summary.trim(),
      confidence: candidate.confidence,
      admissionScore: candidate.admissionScore,
      explicitlyRequested: candidate.explicitlyRequested,
      admissionReason: candidate.admissionReason,
      assessmentJson: candidate.assessmentJson,
      expiresAt: context.expiryFor(candidate),
      updatedAt: context.now,
    });
  }

  /**
   * deleted / superseded 记忆的复活：
   * - deleted：仅当出现新来源时复活（全部来源已知 → null）；
   * - superseded：总是可复活。
   * content 仍保留首次原文。
   */
  reactivate(
    candidate: MemoryCandidate,
    context: MemoryContext,
    knownSourceIds: ReadonlySet<string>,
  ): Memory | null {
    const sourcesAllKnown = candidate.sourceMessageIds
      .every(id => knownSourceIds.has(id));
    if (this.props.status === 'deleted' && sourcesAllKnown) return null;
    return this.withProps({
      summary: candidate.summary.trim(),
      confidence: candidate.confidence,
      admissionScore: candidate.admissionScore,
      explicitlyRequested: candidate.explicitlyRequested,
      admissionReason: candidate.admissionReason,
      assessmentJson: candidate.assessmentJson,
      status: 'active',
      expiresAt: context.expiryFor(candidate),
      deletedAt: undefined,
      updatedAt: context.now,
    });
  }

  /** 预算淘汰：active → superseded。 */
  supersede(now: Date): Memory {
    return this.withProps({ status: 'superseded', updatedAt: now });
  }

  /** 转回持久化记录（Repository 写库契约）。 */
  toRecord(): MemoryRecord {
    return { ...this.props };
  }

  private withProps(overrides: Partial<MemoryRecord>): Memory {
    return new Memory({ ...this.props, ...overrides });
  }
}
