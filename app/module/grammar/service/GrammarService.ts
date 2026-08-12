import { AccessLevel, SingletonProto } from '@eggjs/tegg';
import type {
  Correction,
  GrammarAnalysis,
  GrammarErrorType,
} from '../../ai/service/ProductAIService';
import type { GrammarOccurrenceGroup } from './GrammarPorts';

@SingletonProto({ accessLevel: AccessLevel.PUBLIC })
export class GrammarService {
  prepare(analysis: GrammarAnalysis): GrammarOccurrenceGroup[] {
    if (analysis.explicitGrammarQuestion) return [];

    const grouped = new Map<GrammarErrorType, Correction[]>();
    for (const error of analysis.errors.slice(0, 8)) {
      const detail = this.normalize(error);
      if (!detail) continue;
      const details = grouped.get(detail.errorType) ?? [];
      details.push(detail);
      grouped.set(detail.errorType, details);
    }
    return [ ...grouped.entries() ]
      .sort(([ left ], [ right ]) => left.localeCompare(right))
      .map(([ errorType, details ]) => ({ errorType, details }));
  }

  private normalize(error: Correction): Correction | null {
    const original = error.original.trim();
    const corrected = error.corrected.trim();
    const note = error.note.trim();
    if (!original || !corrected || !note || original === corrected) return null;
    return {
      errorType: error.errorType,
      original: original.slice(0, 300),
      corrected: corrected.slice(0, 300),
      note: note.slice(0, 200),
    };
  }
}
