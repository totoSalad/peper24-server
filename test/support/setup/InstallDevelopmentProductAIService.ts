import { AISDKProductAIService } from '../../../app/module/ai/provider/AISDKProductAIService';
import { DevelopmentProductAIService } from '../fake/DevelopmentProductAIService';

// Integration tests boot the real Egg application, but replace the external AI
// adapter before the app is imported. This file is loaded only by the
// test:integration command and is never part of the application module graph.
const development = new DevelopmentProductAIService();

AISDKProductAIService.prototype.createWelcome = input => development.createWelcome(input);
AISDKProductAIService.prototype.chat = input => development.chat(input);
AISDKProductAIService.prototype.analyzeGrammar = input => development.analyzeGrammar(input);
AISDKProductAIService.prototype.enrichVocabulary = input => development.enrichVocabulary(input);
AISDKProductAIService.prototype.translate = input => development.translate(input);
AISDKProductAIService.prototype.generateDailyLearningSummary = input => (
  development.generateDailyLearningSummary(input)
);
AISDKProductAIService.prototype.extractMemories = input => development.extractMemories(input);
