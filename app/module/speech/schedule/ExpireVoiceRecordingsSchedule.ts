import { Inject } from '@eggjs/tegg';
import { Schedule } from '@eggjs/tegg-schedule-decorator';
import { SpeechService } from '../service/SpeechService';

@Schedule<{ interval: number }>({
  type: 'worker',
  scheduleData: { interval: 60 * 60 * 1000 },
})
export class ExpireVoiceRecordingsSchedule {
  @Inject() private speechService: SpeechService;

  async subscribe(): Promise<void> {
    await this.speechService.expireRecordings();
  }
}
