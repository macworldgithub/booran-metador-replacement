import { Module } from '@nestjs/common';
import { RooftopsController } from './rooftops.controller';
import { RooftopsService } from './rooftops.service';

@Module({
  controllers: [RooftopsController],
  providers: [RooftopsService],
  exports: [RooftopsService],
})
export class RooftopsModule {}
