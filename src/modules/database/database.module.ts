import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StoreService } from './store.service';
import {
  Prospect,
  ProspectSchema,
  ThreadEvent,
  ThreadEventSchema,
  Suppression,
  SuppressionSchema,
  WritebackLog,
  WritebackLogSchema,
  User,
  UserSchema,
} from './schemas';

@Global()
@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGODB_URI as string, {
      dbName: 'matador-replacement',
    }),
    MongooseModule.forFeature([
      { name: Prospect.name, schema: ProspectSchema },
      { name: ThreadEvent.name, schema: ThreadEventSchema },
      { name: Suppression.name, schema: SuppressionSchema },
      { name: WritebackLog.name, schema: WritebackLogSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [StoreService],
  exports: [StoreService, MongooseModule],
})
export class DatabaseModule {}
