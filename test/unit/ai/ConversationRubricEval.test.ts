import assert from 'node:assert/strict';

import {
  buildJudgePrompt,
  buildConversationRubricSchema,
  passedRubric,
  totalScore,
} from '../../../scripts/prompt-debug/conversation/rubric';

describe('Conversation Rubric Eval', () => {
  it('passes a total score of at least five', () => {
    const fivePointResult = {
      contextualCoherence: 2 as const,
      naturalness: 2 as const,
      encouragesContinuation: 1 as const,
      deductions: [{
        dimension: 'encouragesContinuation' as const,
        evidenceQuote: 'Okay.',
        explanation: 'This gives the learner no clear opening to continue.',
      }],
      reason: 'Natural and coherent, but gives the learner only a weak opening to continue.',
    };
    const sixPointResult = {
      ...fivePointResult,
      encouragesContinuation: 2 as const,
      deductions: [],
    };

    assert.equal(totalScore(fivePointResult), 5);
    assert.equal(passedRubric(fivePointResult), true);
    assert.equal(totalScore(sixPointResult), 6);
    assert.equal(passedRubric(sixPointResult), true);
  });

  it('gives the Judge all preceding messages and explicit conflict anchors', () => {
    const prompt = buildJudgePrompt({
      description: 'The latest correction must win.',
      learner: { englishLevel: 'B1' },
      referenceFacts: [ 'Boston is the current city; Seattle is the outdated city.' ],
      messages: [
        { role: 'user', content: 'I live in Seattle.' },
        { role: 'assistant', content: 'Seattle sounds fun.' },
        { role: 'user', content: 'Actually, I moved to Boston.' },
      ],
    }, 'You could explore Seattle this weekend!');

    assert.match(prompt, /I live in Seattle\./);
    assert.match(prompt, /Actually, I moved to Boston\./);
    assert.match(prompt, /You could explore Seattle this weekend!/);
    assert.match(prompt, /uses an outdated fact after a correction/);
    assert.match(prompt, /5\/6 and 6\/6 pass/);
    assert.match(prompt, /verbatim, contiguous evidenceQuote/);
    assert.match(prompt, /first-person anecdotes are allowed/);
    assert.match(prompt, /Boston is the current city; Seattle is the outdated city\./);
  });

  it('rejects deductions whose evidence was hallucinated by the Judge', () => {
    const candidate = 'Boston has many places to explore. What kind of area do you enjoy?';
    const schema = buildConversationRubricSchema(candidate);
    const hallucinated = schema.safeParse({
      contextualCoherence: 2,
      naturalness: 1,
      encouragesContinuation: 2,
      deductions: [{
        dimension: 'naturalness',
        evidenceQuote: "Here's the JSON schema you must follow.",
        explanation: 'The schema instruction is unnatural.',
      }],
      reason: 'The reply contains an unrelated schema instruction.',
    });
    const grounded = schema.safeParse({
      contextualCoherence: 2,
      naturalness: 2,
      encouragesContinuation: 2,
      deductions: [],
      reason: 'The reply is coherent, natural, and easy to continue.',
    });

    assert.equal(hallucinated.success, false);
    assert.equal(grounded.success, true);
  });

  it('rejects a deduction that negates itself during Judge deliberation', () => {
    const candidate = 'You might love Iron & Wine because the acoustic sound is soothing.';
    const result = buildConversationRubricSchema(candidate).safeParse({
      contextualCoherence: 0,
      naturalness: 2,
      encouragesContinuation: 2,
      deductions: [{
        dimension: 'contextualCoherence',
        evidenceQuote: candidate,
        explanation: 'Wait, this recommendation is actually coherent and there is no contradiction.',
      }],
      reason: 'Let me re-evaluate: the recommendation is valid.',
    });

    assert.equal(result.success, false);
  });
});
