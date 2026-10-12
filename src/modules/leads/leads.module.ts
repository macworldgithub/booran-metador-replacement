import { Module } from '@nestjs/common';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { ComplianceModule } from '../compliance/compliance.module';
import { JourneyModule } from '../journey/journey.module';
import { WritebackModule } from '../writeback/writeback.module';

@Module({
  imports: [ComplianceModule, JourneyModule, WritebackModule],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
