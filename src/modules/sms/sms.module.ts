import { Module } from '@nestjs/common';
import { SmsController } from './sms.controller';
import { SmsService } from './sms.service';
import { ComplianceModule } from '../compliance/compliance.module';
import { WritebackModule } from '../writeback/writeback.module';

@Module({
  imports: [ComplianceModule, WritebackModule],
  controllers: [SmsController],
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}
