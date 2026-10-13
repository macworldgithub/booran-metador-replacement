import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ThreadEventType, DeliveryStatus } from '../../../common/enums';

export type ThreadEventDocument = HydratedDocument<ThreadEvent>;

@Schema({ collection: 'thread_events', versionKey: false })
export class ThreadEvent {
  @Prop({ required: true, unique: true, index: true })
  id: string;

  @Prop({ required: true, index: true })
  prospectId: string;

  @Prop({ required: true, enum: Object.values(ThreadEventType) })
  type: string;

  @Prop({ required: true, enum: ['outbound', 'inbound', 'internal'] })
  direction: string;

  @Prop({ required: true })
  content: string;

  @Prop()
  authorName?: string;

  @Prop()
  journeyStepName?: string;

  @Prop({ enum: Object.values(DeliveryStatus) })
  deliveryStatus?: string;

  @Prop()
  failureReason?: string;

  @Prop({ type: [String], default: [] })
  mediaUrls?: string[];

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  @Prop({ required: true, index: true })
  timestamp: Date;
}

export const ThreadEventSchema = SchemaFactory.createForClass(ThreadEvent);

// Compound index for fetching all events for a prospect in order
ThreadEventSchema.index({ prospectId: 1, timestamp: 1 });
