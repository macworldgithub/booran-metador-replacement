import { Module } from '@nestjs/common';
import { WritebackController } from './writeback.controller';
import { WritebackService } from './writeback.service';

@Module({
  controllers: [WritebackController],
  providers: [WritebackService],
  exports: [WritebackService],
})
export class WritebackModule {}
