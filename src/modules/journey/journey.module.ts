import { Module } from '@nestjs/common';
import { JourneyService } from './journey.service';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [SmsModule],
  providers: [JourneyService],
  exports: [JourneyService],
})
export class JourneyModule {}
