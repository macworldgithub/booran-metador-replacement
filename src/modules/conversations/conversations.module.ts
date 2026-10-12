import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { SmsModule } from '../sms/sms.module';
import { JourneyModule } from '../journey/journey.module';
import { WritebackModule } from '../writeback/writeback.module';

@Module({
  imports: [SmsModule, JourneyModule, WritebackModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
