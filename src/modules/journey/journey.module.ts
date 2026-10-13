import { Module } from '@nestjs/common';
import { JourneyService } from './journey.service';
import { SmsModule } from '../sms/sms.module';

import { JourneySchedulerService } from './journey-scheduler.service';

@Module({
  imports: [SmsModule],
  providers: [JourneyService, JourneySchedulerService],
  exports: [JourneyService, JourneySchedulerService],
})
export class JourneyModule {}
