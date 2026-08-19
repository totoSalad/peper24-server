import {
  ChatEvent,
  ChatInput,
  DailyLearningSummaryGeneration,
  DailyLearningSummaryInput,
  GrammarAnalysis,
  GrammarAnalysisInput,
  MemoryExtractionInput,
  MemoryExtractionResult,
  ProductAIService,
  TranslationInput,
  TranslationResult,
  VocabularyEnrichment,
  VocabularyEnrichmentInput,
  WelcomeInput,
} from '../../../app/module/ai/service/ProductAIService';

export class DevelopmentProductAIService extends ProductAIService {
  async createWelcome(input: WelcomeInput): Promise<string> {
    if (input.scene === '餐厅点餐') {
      return 'Hi! Welcome to the restaurant. What would you like to order today?';
    }
    return `Let’s talk about ${input.topic}. What comes to your mind first?`;
  }

  async* chat(input: ChatInput): AsyncIterable<ChatEvent> {
    yield { type: 'message.start', messageId: input.messageId };
    const response = `Thanks for sharing. ${input.content} What happened next?`;
    for (const delta of response.match(/\S+\s*/g) ?? [ response ]) {
      if (input.signal?.aborted) throw new Error('request aborted');
      yield { type: 'message.delta', messageId: input.messageId, delta };
    }
    yield {
      type: 'message.done',
      messageId: input.messageId,
      usage: {
        provider: 'development',
        model: 'deterministic-chat',
        inputTokens: Math.ceil(input.content.length / 4),
        outputTokens: Math.ceil(response.length / 4),
      },
    };
  }

  async analyzeGrammar(input: GrammarAnalysisInput): Promise<GrammarAnalysis> {
    if (/\b(should i say|is .+ correct|grammar)\b|语法|怎么用|对不对/i.test(input.content)) {
      return { explicitGrammarQuestion: true, errors: [] };
    }

    const errors: GrammarAnalysis['errors'] = [];
    const agreement = input.content.match(/\b(she|he|it)\s+(like|play|work)\b/i);
    if (agreement) {
      const original = agreement[0];
      errors.push({
        errorType: 'subject_verb_agreement',
        original,
        corrected: `${agreement[1]} ${agreement[2]}s`,
        note: '第三人称单数主语后的动词通常需要加 s。',
      });
    }
    const tense = input.content.match(/\byesterday\b[^.?!]*\bgo\b/i);
    if (tense) {
      errors.push({
        errorType: 'tense',
        original: tense[0],
        corrected: tense[0].replace(/\bgo\b/i, 'went'),
        note: '过去发生的事情通常使用过去式。',
      });
    }
    const article = input.content.match(/\b(bought|has)\s+(book|cat)\b/i);
    if (article) {
      errors.push({
        errorType: 'article',
        original: article[0],
        corrected: `${article[1]} a ${article[2]}`,
        note: '可数名词单数前通常需要冠词。',
      });
    }
    const preposition = input.content.match(/\bdepend\s+of\b/i);
    if (preposition) {
      errors.push({
        errorType: 'preposition_collocation',
        original: preposition[0],
        corrected: preposition[0].replace(/\bof\b/i, 'on'),
        note: 'depend 通常与介词 on 搭配。',
      });
    }
    return { explicitGrammarQuestion: false, errors: errors.slice(0, 8) };
  }

  async enrichVocabulary(input: VocabularyEnrichmentInput): Promise<VocabularyEnrichment | null> {
    const text = input.text.trim();
    const normalized = text.normalize('NFKC').toLocaleLowerCase('en-US');
    const known: Record<string, VocabularyEnrichment> = {
      'whole wheat bread': {
        cnMeaning: '全麦面包', enMeaning: 'whole wheat bread',
        example: 'Would you like your sandwich on whole wheat bread?',
        phonetic: '/hoʊl wiːt bred/',
      },
      'almost late': {
        cnMeaning: '差点迟到', enMeaning: 'almost late',
        example: 'I was almost late today.',
        phonetic: '/ˈɔːlmoʊst leɪt/',
      },
    };
    return known[normalized] ?? {
      cnMeaning: '开发环境释义', enMeaning: text,
      example: input.context || `I learned the expression “${text}” today.`,
      phonetic: '/demo/',
    };
  }

  async translate(input: TranslationInput): Promise<TranslationResult> {
    return {
      translation: input.targetLanguage === 'Chinese'
        ? `开发环境翻译：${input.content}`
        : `Development translation: ${input.content}`,
    };
  }

  async generateDailyLearningSummary(
    input: DailyLearningSummaryInput,
  ): Promise<DailyLearningSummaryGeneration> {
    const grammar = input.metrics.grammar[0];
    return {
      content: {
        headline: input.metrics.userMessageCount >= 10
          ? '今天完成了扎实的英语练习'
          : '今天保持了英语练习',
        highlights: [
          `完成 ${input.metrics.conversationCount} 次对话，发送 ${input.metrics.userMessageCount} 条消息。`,
          ...(input.metrics.newVocabularyCount
            ? [ `新增 ${input.metrics.newVocabularyCount} 个表达。` ]
            : []),
        ],
        improvements: grammar
          ? [ `继续注意 ${grammar.errorType}。` ]
          : [ '今天没有发现需要主动提醒的重复语法问题。' ],
        nextSteps: [ input.metrics.newVocabularyCount
          ? '明天复习今天新增的表达。'
          : '明天继续完成一次短对话。' ],
      },
      usage: {
        provider: 'development', model: 'deterministic-daily-summary',
        inputTokens: 0, outputTokens: 0,
      },
    };
  }

  async extractMemories(input: MemoryExtractionInput): Promise<MemoryExtractionResult> {
    void input;
    return { decisions: [{
      shouldSave: false, reason: 'Development provider saves no automatic memories.',
    }] };
  }
}
