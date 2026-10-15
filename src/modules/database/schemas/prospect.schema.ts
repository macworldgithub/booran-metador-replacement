import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
  RooftopId,
  ProspectStatus,
  ProspectOutcome,
} from '../../../common/enums';

export type ProspectDocument = HydratedDocument<Prospect>;

@Schema({ collection: 'prospects', timestamps: true, versionKey: false })
export class Prospect {
  @Prop({ type: Object })
  sourceSync?: {
    mode: 'lead_forward' | 'live_scrape' | 'backfill';
    fingerprint?: string;
    scrapedAt?: Date;
    sourceUrl?: string;
  };

  @Prop() receivedAt?: Date;
  @Prop({ default: 'new_vehicle_internet' }) leadType?: string;
  @Prop({ type: Object }) consent?: Record<string, any>;
  @Prop({ type: [String], default: [] }) opportunityAliases?: string[];
  // Application-level string ID (kept for compatibility with existing code)
  @Prop({ required: true, unique: true, index: true })
  id: string;

  @Prop({ required: true, index: true })
  dealerSocketOpportunityId: string;

  @Prop()
  dealerSocketCustomerId?: string;

  @Prop({ required: true, enum: Object.values(RooftopId), index: true })
  rooftopId: string;

  @Prop({ type: Object, required: true })
  customer: {
    firstName: string;
    lastName?: string;
    mobile: string;
    email?: string;
  };

  @Prop({ required: true, index: true })
  normalizedMobile: string;

  @Prop({ type: Object, default: {} })
  vehicle: {
    make?: string;
    model?: string;
    year?: number;
    isNew?: boolean;
    stockNumber?: string;
    comments?: string;
  };

  @Prop({ required: true })
  leadSource: string;

  @Prop({ type: Object })
  assignedTo?: {
    name: string;
    email?: string;
    id?: string;
  };

  @Prop({
    required: true,
    enum: Object.values(ProspectStatus),
    default: ProspectStatus.NEW,
  })
  status: string;

  @Prop({ type: Object, required: true })
  journey: {
    status: 'active' | 'paused' | 'completed' | 'stopped';
    currentStep: number;
    currentStepName: string;
    pausedReason?: string;
    lastStepSentAt?: Date;
    nextScheduledStepAt?: Date;
  };

  @Prop({ enum: Object.values(ProspectOutcome) })
  outcome?: string;

  @Prop({ default: 0 })
  unreadInboundCount: number;

  @Prop()
  lastInboundAt?: Date;

  @Prop({ required: true })
  lastActivityAt: Date;
}

export const ProspectSchema = SchemaFactory.createForClass(Prospect);

// Compound index for 14-day duplicate detection (mobile + rooftop + createdAt)
ProspectSchema.index({ normalizedMobile: 1, rooftopId: 1, createdAt: -1 });
