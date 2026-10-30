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
import { DealerSocketModule } from './modules/dealersocket/dealersocket.module';
import { MailModule } from './modules/mail/mail.module';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
  imports: [
    ScheduleModule.forRoot(),
    DatabaseModule,
    MailModule,
    AuthModule,
    UsersModule,
    OperationsModule,
    DealerSocketModule,
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
