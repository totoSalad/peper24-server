import type { MemoryAdmissionDecision } from '../../ai/service/ProductAIService';
import type { MemoryCandidate, MemorySourceMessage } from './MemoryPorts';

const secretPattern = /(?:password|passcode|verification code|验证码|密码|api[ _-]?key|(?:access[ _-]?)?token|令牌|private[ _-]?key|client[ _-]?secret)/i;

function compareSources(left: MemorySourceMessage, right: MemorySourceMessage): number {
  return left.createdAt.getTime() - right.createdAt.getTime()
    || left.sequence - right.sequence
    || left.id.localeCompare(right.id);
}

export function admitMemoryDecision(
  decision: MemoryAdmissionDecision,
  availableSources: MemorySourceMessage[],
  targetIds: Set<string>,
): MemoryCandidate | null {
  if (!decision.shouldSave) return null;
  const uniqueSourceIds = [ ...new Set(decision.sourceMessageIds) ];
  const sourceById = new Map(availableSources
    .filter(item => item.role === 'user')
    .map(item => [ item.id, item ]));
  if (!uniqueSourceIds.length
    || !uniqueSourceIds.some(id => targetIds.has(id))
    || uniqueSourceIds.some(id => !sourceById.has(id))) return null;
  const sources = uniqueSourceIds.map(id => sourceById.get(id)!).sort(compareSources);
  if (decision.inferredOrHypothetical || decision.containsSecret
    || decision.scores.explicitness < 2
    || sources.some(item => secretPattern.test(item.content))) return null;
  if ((decision.layer === 'short_term') !== (decision.type === 'short_term')) return null;
  if (decision.layer === 'short_term' && !decision.temporaryDays) return null;

  const { futureValue, personalImportance, explicitness } = decision.scores;
  const rawAdmissionScore = futureValue + personalImportance + explicitness
    - decision.penalties.length * 2;
  if (!decision.explicitRemember) {
    if (decision.layer === 'long_term' && (rawAdmissionScore < 4
      || decision.scores.futureValue < 1)) return null;
    if (decision.layer === 'short_term' && (rawAdmissionScore < 2
      || decision.scores.futureValue < 1)) return null;
  }
  const admissionScore = Math.max(0, rawAdmissionScore);

  return {
    type: decision.type,
    content: sources[0].content,
    summary: decision.summary.trim(),
    normalizedKey: decision.normalizedKey,
    confidence: decision.scores.explicitness / 2,
    admissionScore,
    explicitlyRequested: decision.explicitRemember,
    admissionReason: decision.reason.trim(),
    assessmentJson: JSON.stringify({
      scores: decision.scores,
      penalties: decision.penalties,
      layer: decision.layer,
      rawAdmissionScore,
    }),
    temporaryDays: decision.temporaryDays,
    sourceMessageIds: uniqueSourceIds,
  };
}
