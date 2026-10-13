import { Module } from '@nestjs/common';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { ComplianceModule } from '../compliance/compliance.module';
import { JourneyModule } from '../journey/journey.module';
import { WritebackModule } from '../writeback/writeback.module';

import { AdfParserService } from './adf/adf-parser.service';
import { AdfIntakeController } from './adf/adf-intake.controller';

@Module({
  imports: [ComplianceModule, JourneyModule, WritebackModule],
  controllers: [LeadsController, AdfIntakeController],
  providers: [LeadsService, AdfParserService],
  exports: [LeadsService, AdfParserService],
})
export class LeadsModule {}
