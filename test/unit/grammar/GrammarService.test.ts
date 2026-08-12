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
});
