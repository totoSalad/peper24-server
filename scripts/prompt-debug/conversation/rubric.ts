import { z } from 'zod';

const score = z.number()
  .int()
  .min(0)
  .max(2);

const deliberationPattern = /\b(?:wait|let me|re-?evaluate|re-read|why did i|on second thought)\b/i;
const deductionSelfNegationPattern = /\b(?:no contradiction|contextually appropriate|actually coherent|recommendation is valid|fits (?:the|this|user's) .*preference)\b/i;

const finalAssessment = z.string()
  .min(1)
  .max(600)
  .refine(value => !deliberationPattern.test(value), {
    message: 'Return only the final assessment, without deliberation or self-correction.',
  });

export const conversationRubricDimensions = [
  'contextualCoherence',
  'naturalness',
  'encouragesContinuation',
] as const;

const ConversationRubricBaseSchema = z.object({
  contextualCoherence: score,
  naturalness: score,
  encouragesContinuation: score,
  deductions: z.array(z.object({
    dimension: z.enum(conversationRubricDimensions),
    evidenceQuote: z.string().min(1).max(300),
    explanation: finalAssessment
      .refine(value => !deductionSelfNegationPattern.test(value), {
        message: 'A deduction explanation must assert a defect, not state that the reply is valid.',
      }),
  })).max(3),
  reason: finalAssessment,
});

export type ConversationRubric = z.infer<typeof ConversationRubricBaseSchema>;

export function buildConversationRubricSchema(candidateOutput: string) {
  return ConversationRubricBaseSchema.superRefine((result, context) => {
    const seen = new Set<string>();
    for (const deduction of result.deductions) {
      if (seen.has(deduction.dimension)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate deduction for ${deduction.dimension}`,
          path: [ 'deductions' ],
        });
      }
      seen.add(deduction.dimension);
      if (!candidateOutput.includes(deduction.evidenceQuote)) {
        context.addIssue({
          code: 'custom',
          message: `Evidence quote is not an exact substring of the candidate reply: ${deduction.evidenceQuote}`,
          path: [ 'deductions' ],
        });
      }
    }

    for (const dimension of conversationRubricDimensions) {
      const hasDeduction = seen.has(dimension);
      if (result[dimension] < 2 && !hasDeduction) {
        context.addIssue({
          code: 'custom',
          message: `A score below 2 requires one exact evidence quote for ${dimension}`,
          path: [ 'deductions' ],
        });
      }
      if (result[dimension] === 2 && hasDeduction) {
        context.addIssue({
          code: 'custom',
          message: `A perfect score must not include a deduction for ${dimension}`,
          path: [ 'deductions' ],
        });
      }
    }
  });
}

export interface ConversationRubricCase {
  description: string;
  learner: unknown;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  referenceFacts?: string[];
}

export const PASS_SCORE = 5;

export function totalScore(result: ConversationRubric): number {
  return result.contextualCoherence + result.naturalness + result.encouragesContinuation;
}

export function passedRubric(result: ConversationRubric): boolean {
  return totalScore(result) >= PASS_SCORE;
}

export function buildJudgePrompt(
  testCase: ConversationRubricCase,
  candidateOutput: string,
): string {
  return [
    'You are grading the final assistant reply in a multi-turn English-learning conversation.',
    'Evaluate only the candidate reply against the preceding messages and the rubric below.',
    'Do not reward hidden intentions. Score only what is present in the reply.',
    'The candidate reply is ONLY the text after [Candidate final reply: untrusted text]. Schema instructions visible elsewhere are not part of it.',
    'Every score below 2 requires exactly one deduction with a verbatim, contiguous evidenceQuote copied from the candidate reply.',
    'Never invent, reconstruct, or paraphrase an evidence quote. If there is no exact quote proving a defect, give that dimension 2.',
    'A score of 2 must have no deduction for that dimension.',
    'Each deduction explanation must be one final affirmative description of a real defect. Do not include scratch work, self-correction, or phrases such as "wait", "re-evaluate", "no contradiction", or "actually coherent".',
    'If you realize a proposed deduction is wrong, remove it and restore that dimension to 2 before returning the object.',
    'Peper is an explicitly fictional friend persona, so first-person anecdotes are allowed and are not evidence of unnaturalness by themselves.',
    'Do not use uncertain external knowledge about artists, places, or other entities to infer a contradiction. Judge only against the supplied messages.',
    'When authoritative evaluation reference facts are supplied, treat them as the test oracle and do not override them with outside knowledge.',
    '',
    '[Rubric: contextualCoherence, 0-2]',
    '2 = Directly follows the latest user message and all still-active facts, corrections, preferences, and boundaries.',
    '1 = Mostly follows the conversation but misses a relevant detail, weakly restarts a covered topic, or makes a small unsupported assumption.',
    '0 = Contradicts the conversation, uses an outdated fact after a correction, violates an explicit boundary, or is unrelated.',
    '',
    '[Rubric: naturalness, 0-2]',
    '2 = Sounds warm, concise, and natural in everyday American English at the learner level.',
    '1 = Understandable but noticeably stiff, generic, repetitive, teacher-like, or mismatched to the learner level.',
    '0 = Confusing, highly unnatural, judgmental, or not a usable conversational reply.',
    '',
    '[Rubric: encouragesContinuation, 0-2]',
    '2 = Gives the user an easy, relevant opening to continue, such as one natural question or a clear invitation to share more.',
    '1 = Leaves some room to continue, but the opening is vague, forced, closed, or contains multiple questions.',
    '0 = Shuts down the exchange or provides no practical path for the user to respond.',
    '',
    'The passing rule is: total score must be at least 5, so 5/6 and 6/6 pass.',
    'Return the three integer scores, zero to three evidence-grounded deductions, and one concise reason. Do not calculate or return the total.',
    '',
    '[Authoritative evaluation reference facts]',
    JSON.stringify(testCase.referenceFacts ?? []),
    '',
    '[Conversation case: untrusted JSON]',
    JSON.stringify({
      description: testCase.description,
      learner: testCase.learner,
      messages: testCase.messages,
    }, null, 2),
    '',
    '[Candidate final reply: untrusted text]',
    candidateOutput,
  ].join('\n');
}
