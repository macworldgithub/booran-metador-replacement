import { Module } from '@nestjs/common';
import { DealerSocketController } from './dealersocket.controller';
import { DealerSocketService } from './dealersocket.service';

@Module({ controllers: [DealerSocketController], providers: [DealerSocketService] })
export class DealerSocketModule {}
