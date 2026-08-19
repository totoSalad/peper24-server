import { strict as assert } from 'node:assert';
import { Memory } from '../../../app/module/memory/domain/Memory';
import {
  MemoryCandidate,
  MemoryRecord,
} from '../../../app/module/memory/service/MemoryPorts';

const now = new Date('2026-08-06T00:00:00.000Z');

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: 'm1',
    userId: 'u1',
    type: 'preference',
    content: '喜欢在周末徒步',
    summary: 'Enjoys weekend hiking',
    normalizedKey: 'weekend hiking',
    confidence: 0.9,
    admissionScore: 7,
    explicitlyRequested: false,
    admissionReason: 'Stable preference',
    assessmentJson: '{}',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function candidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    type: 'preference',
    content: '喜欢在周末徒步',
    summary: 'Enjoys weekend hiking',
    normalizedKey: 'weekend hiking',
    confidence: 0.9,
    admissionScore: 7,
    explicitlyRequested: false,
    admissionReason: 'Stable preference',
    assessmentJson: '{}',
    sourceMessageIds: [ '01MESSAGE' ],
    ...overrides,
  };
}

const ctx = (nowAt: Date = now) => ({
  now: nowAt,
  expiryFor: (item: MemoryCandidate) => {
    if (item.type !== 'short_term') return undefined;
    return new Date(nowAt.getTime() + (item.temporaryDays ?? 7) * 24 * 60 * 60 * 1000);
  },
});

describe('Memory（充血领域类）', () => {
  it('把状态转换规则内聚在对象方法上（数据只读，只能通过行为改变）', () => {
    const memory = Memory.fromRecord(record());
    // 数据只能读，不能从外部直接改 status/content
    assert.equal(memory.status, 'active');
    assert.equal(memory.content, '喜欢在周末徒步');
    // 长期记忆（preference）不自动过期，任何时刻都 active
    assert.equal(memory.isActiveAt(now), true);
    assert.equal(memory.isActiveAt(new Date('2099-01-01')), true);
  });

  it('isActiveAt 同时校验 status 与过期时间（short_term）', () => {
    const expired = Memory.fromRecord(record({
      type: 'short_term',
      expiresAt: new Date('2026-08-05'),
    }));
    assert.equal(expired.isActiveAt(now), false);

    const deleted = Memory.fromRecord(record({ status: 'deleted' }));
    assert.equal(deleted.isActiveAt(now), false);

    const superseded = Memory.fromRecord(record({ status: 'superseded' }));
    assert.equal(superseded.isActiveAt(now), false);
  });

  it('mergeWith：同 key active 合并只更新 summary/评分，永不覆盖 content', () => {
    const memory = Memory.fromRecord(record());
    const merged = memory.mergeWith(candidate({
      content: '现在不再喜欢周末徒步',
      summary: 'No longer enjoys weekend hiking',
      sourceMessageIds: [ '03MESSAGE' ],
    }), ctx());
    assert.ok(merged);
    // content 保留首次原文，summary 更新
    assert.equal(merged!.content, '喜欢在周末徒步');
    assert.equal(merged!.summary, 'No longer enjoys weekend hiking');
    assert.equal(merged!.status, 'active');
  });

  it('mergeWith：summary 未变化时返回 null（无变更，不重复写库）', () => {
    const memory = Memory.fromRecord(record());
    assert.equal(memory.mergeWith(candidate(), ctx()), null);
  });

  it('reactivate：deleted 记忆在新来源下复活，content 仍保留首次原文', () => {
    const deleted = Memory.fromRecord(record({ status: 'deleted', deletedAt: now }));
    const revived = deleted.reactivate(candidate({
      content: '我又开始周末徒步了',
      summary: 'Enjoys weekend hiking again',
      sourceMessageIds: [ '04MESSAGE' ],
    }), ctx(), new Set([ '01MESSAGE' ]));
    assert.ok(revived);
    assert.equal(revived!.status, 'active');
    assert.equal(revived!.deletedAt, undefined);
    assert.equal(revived!.content, '喜欢在周末徒步');
    assert.equal(revived!.summary, 'Enjoys weekend hiking again');
  });

  it('reactivate：deleted 记忆全部来源已知时返回 null（不复活）', () => {
    const deleted = Memory.fromRecord(record({ status: 'deleted', deletedAt: now }));
    const known = new Set([ '01MESSAGE' ]);
    const result = deleted.reactivate(candidate({ sourceMessageIds: [ '01MESSAGE' ] }), ctx(), known);
    assert.equal(result, null);
  });

  it('reactivate：superseded 记忆总是可复活（restore）', () => {
    const superseded = Memory.fromRecord(record({ status: 'superseded' }));
    const revived = superseded.reactivate(candidate({
      summary: 'Enjoys weekend hiking again',
      sourceMessageIds: [ '04MESSAGE' ],
    }), ctx(), new Set());
    assert.ok(revived);
    assert.equal(revived!.status, 'active');
    assert.equal(revived!.summary, 'Enjoys weekend hiking again');
  });

  it('supersede：淘汰为 superseded 并推进 updatedAt', () => {
    const memory = Memory.fromRecord(record());
    const evicted = memory.supersede(new Date(now.getTime() + 1000));
    assert.equal(evicted.status, 'superseded');
    assert.equal(evicted.updatedAt.getTime(), now.getTime() + 1000);
  });

  it('create：从 candidate 工厂创建新记忆，expiry 由上下文决定', () => {
    const created = Memory.create(
      'u1',
      '01MEMORY',
      candidate({ type: 'short_term', temporaryDays: 14 }),
      ctx(),
    );
    assert.equal(created.status, 'active');
    assert.equal(created.userId, 'u1');
    assert.equal(created.id, '01MEMORY');
    assert.equal(
      created.expiresAt?.toISOString(),
      new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    );
  });

  it('fromRecord/toRecord 保持记录字段等价（Repository 互转契约）', () => {
    const original = record({ status: 'deleted', deletedAt: now, expiresAt: undefined });
    const roundtrip = Memory.fromRecord(original).toRecord();
    assert.deepEqual(roundtrip, original);
  });
});
