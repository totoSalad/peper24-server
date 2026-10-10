import { strict as assert } from 'node:assert';
import { GrammarService } from '../../../app/module/grammar/service/GrammarService';

describe('GrammarService', () => {
  it('groups concrete errors by fixed type and keeps every detail', () => {
    const service = new GrammarService();

    const groups = service.prepare({
      explicitGrammarQuestion: false,
      errors: [
        {
          errorType: 'subject_verb_agreement',
          original: 'She like music.',
          corrected: 'She likes music.',
          note: '第三人称单数动词需要加 s。',
        },
        {
          errorType: 'subject_verb_agreement',
          original: 'He play football.',
          corrected: 'He plays football.',
          note: '第三人称单数动词需要加 s。',
        },
        {
          errorType: 'article',
          original: 'I bought book.',
          corrected: 'I bought a book.',
          note: '可数名词单数前通常需要冠词。',
        },
      ],
    });

    assert.deepEqual(groups.map(group => group.errorType), [
      'article',
      'subject_verb_agreement',
    ]);
    assert.equal(groups[1].details.length, 2);
  });

  it('does not create proactive correction records for an explicit grammar question', () => {
    const service = new GrammarService();

    const groups = service.prepare({
      explicitGrammarQuestion: true,
      errors: [
        {
          errorType: 'tense',
          original: 'Yesterday I go to school.',
          corrected: 'Yesterday I went to school.',
          note: '过去发生的事情使用过去式。',
        },
      ],
    });

    assert.deepEqual(groups, []);
  });

  it('accepts at most eight valid concrete errors from one analysis', () => {
    const service = new GrammarService();
    const errors = Array.from({ length: 10 }, (_, index) => ({
      errorType: 'tense' as const,
      original: `Yesterday I go ${index}.`,
      corrected: `Yesterday I went ${index}.`,
      note: '过去发生的事情使用过去式。',
    }));

    const groups = service.prepare({ explicitGrammarQuestion: false, errors });

    assert.equal(groups[0].details.length, 8);
  });

  it('keeps one copy of corrections that match after trim and length normalization', () => {
    const service = new GrammarService();
    const longOriginal = `I bought ${'very '.repeat(70)}book.`;
    const longCorrected = `I bought a ${'very '.repeat(70)}book.`;
    const longNote = `Use an article. ${'Details '.repeat(30)}`;

    const groups = service.prepare({
      explicitGrammarQuestion: false,
      errors: [
        {
          errorType: 'article',
          original: 'I bought book.',
          corrected: 'I bought a book.',
          note: 'Use an article.',
        },
        {
          errorType: 'article',
          original: '  I bought book. ',
          corrected: '\nI bought a book.\t',
          note: ' Use an article. ',
        },
        {
          errorType: 'article',
          original: longOriginal,
          corrected: longCorrected,
          note: longNote,
        },
        {
          errorType: 'article',
          original: `${longOriginal.slice(0, 300)}different suffix`,
          corrected: `${longCorrected.slice(0, 300)}different suffix`,
          note: `${longNote.slice(0, 200)}different suffix`,
        },
      ],
    });

    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].details, [
      {
        errorType: 'article',
        original: 'I bought book.',
        corrected: 'I bought a book.',
        note: 'Use an article.',
      },
      {
        errorType: 'article',
        original: longOriginal.slice(0, 300),
        corrected: longCorrected.slice(0, 300),
        note: longNote.slice(0, 200),
      },
    ]);
  });

  it('keeps corrections when any normalized field differs', () => {
    const service = new GrammarService();
    const base = {
      errorType: 'article' as const,
      original: 'I bought book.',
      corrected: 'I bought a book.',
      note: 'Use an article.',
    };

    const groups = service.prepare({
      explicitGrammarQuestion: false,
      errors: [
        base,
        { ...base, original: 'She bought book.' },
        { ...base, corrected: 'I bought the book.' },
        { ...base, note: 'Use a determiner.' },
        { ...base, errorType: 'countable_uncountable' },
      ],
    });

    assert.deepEqual(groups.map(group => group.errorType), [ 'article', 'countable_uncountable' ]);
    assert.equal(groups[0].details.length, 4);
    assert.deepEqual(groups[0].details.map(detail => detail.original), [
      'I bought book.',
      'She bought book.',
      'I bought book.',
      'I bought book.',
    ]);
    assert.equal(groups[1].details.length, 1);
  });

  it('preserves first-seen order within sorted types after filtering duplicates', () => {
    const service = new GrammarService();
    const firstTense = {
      errorType: 'tense' as const,
      original: 'Yesterday I go home.',
      corrected: 'Yesterday I went home.',
      note: 'Use past tense.',
    };

    const groups = service.prepare({
      explicitGrammarQuestion: false,
      errors: [
        firstTense,
        {
          errorType: 'article',
          original: 'I saw dog.',
          corrected: 'I saw a dog.',
          note: 'Use an article.',
        },
        {
          errorType: 'tense',
          original: 'Last week she visits me.',
          corrected: 'Last week she visited me.',
          note: 'Use past tense.',
        },
        { ...firstTense },
      ],
    });

    assert.deepEqual(groups.map(group => group.errorType), [ 'article', 'tense' ]);
    assert.deepEqual(groups[1].details.map(detail => detail.original), [
      'Yesterday I go home.',
      'Last week she visits me.',
    ]);
  });

  it('applies the first-eight raw input limit before validation and duplicate removal', () => {
    const service = new GrammarService();
    const duplicate = {
      errorType: 'article' as const,
      original: 'I bought book.',
      corrected: 'I bought a book.',
      note: 'Use an article.',
    };

    const groups = service.prepare({
      explicitGrammarQuestion: false,
      errors: [
        duplicate,
        { ...duplicate },
        { ...duplicate, original: ' ', corrected: 'valid', note: 'invalid' },
        { ...duplicate, original: 'same', corrected: 'same', note: 'invalid' },
        { ...duplicate },
        { ...duplicate },
        { ...duplicate },
        { ...duplicate },
        {
          errorType: 'tense',
          original: 'Yesterday I go home.',
          corrected: 'Yesterday I went home.',
          note: 'Use past tense.',
        },
      ],
    });

    assert.deepEqual(groups.map(group => group.errorType), [ 'article' ]);
    assert.equal(groups[0].details.length, 1);
  });
});
