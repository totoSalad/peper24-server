import { Inject } from '@eggjs/tegg';
import { Schedule } from '@eggjs/tegg-schedule-decorator';
import { LearningSummaryService } from '../service/LearningSummaryService';

@Schedule<{ interval: number }>({
  type: 'worker',
  scheduleData: { interval: 24 * 60 * 1000 },
})
export class GenerateLearningSummariesSchedule {
  @Inject() private learningSummaryService: LearningSummaryService;

  async subscribe(): Promise<void> {
    await this.learningSummaryService.processRecent();
  }
}
