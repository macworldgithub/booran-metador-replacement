import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './modules/database/database.module';
import { RooftopsModule } from './modules/rooftops/rooftops.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { SmsModule } from './modules/sms/sms.module';
import { JourneyModule } from './modules/journey/journey.module';
import { WritebackModule } from './modules/writeback/writeback.module';
import { LeadsModule } from './modules/leads/leads.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { OperationsModule } from './modules/operations/operations.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    DatabaseModule,
    AuthModule,
    UsersModule,
    OperationsModule,
    RooftopsModule,
    ComplianceModule,
    SmsModule,
    JourneyModule,
    WritebackModule,
    LeadsModule,
    ConversationsModule,
  ],
})
export class AppModule {}
