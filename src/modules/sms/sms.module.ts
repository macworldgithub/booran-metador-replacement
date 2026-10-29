import { Module } from '@nestjs/common';
import { SmsController } from './sms.controller';
import { MobileMessageService } from './mobile-message.service';
import { SmsService } from './sms.service';
import { ComplianceModule } from '../compliance/compliance.module';
import { WritebackModule } from '../writeback/writeback.module';

@Module({
  imports: [ComplianceModule, WritebackModule],
  controllers: [SmsController],
  providers: [SmsService, MobileMessageService],
  exports: [SmsService],
})
export class SmsModule {}
