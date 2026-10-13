import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StoreService } from '../database/store.service';
import { JourneyService } from './journey.service';

@Injectable()
export class JourneySchedulerService {
  private readonly logger = new Logger(JourneySchedulerService.name);
  private isProcessing = false;

  constructor(
    private readonly store: StoreService,
    private readonly journeyService: JourneyService,
  ) {}

  /**
   * Run every 5 minutes to evaluate due steps across all active journeys.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleCron() {
    if (this.isProcessing) {
      this.logger.debug('Previous journey scheduler run still active, skipping tick.');
      return;
    }

    this.isProcessing = true;

    try {
      const now = new Date();
      const dueProspects = await this.store.findDueJourneys(now);

      if (dueProspects.length > 0) {
        this.logger.log(`Found ${dueProspects.length} prospect(s) with due journey steps.`);

        for (const prospect of dueProspects) {
          try {
            await this.journeyService.processDueProspect(prospect);
          } catch (err: any) {
            this.logger.error(
              `Error processing journey for prospect ${prospect.id}: ${err.message}`,
              err.stack,
            );
          }
        }
      }
    } catch (err: any) {
      this.logger.error(`Journey scheduler cycle failed: ${err.message}`, err.stack);
    } finally {
      this.isProcessing = false;
    }
  }
}
