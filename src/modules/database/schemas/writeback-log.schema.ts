import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type WritebackLogDocument = HydratedDocument<WritebackLog>;

@Schema({ collection: 'writeback_logs', timestamps: true, versionKey: false })
export class WritebackLog {
  @Prop({ required: true, unique: true, index: true })
  id: string;

  @Prop({ required: true, index: true })
  prospectId: string;

  @Prop({ required: true })
  opportunityId: string;

  @Prop({ required: true })
  action: string;

  @Prop({ required: true })
  payload: string;

  @Prop({
    required: true,
    enum: ['pending', 'success', 'failed'],
    default: 'pending',
    index: true,
  })
  status: string;

  @Prop({ default: 0 })
  attempts: number;

  @Prop()
  lastAttemptAt?: Date;

  @Prop()
  error?: string;
}

export const WritebackLogSchema = SchemaFactory.createForClass(WritebackLog);
