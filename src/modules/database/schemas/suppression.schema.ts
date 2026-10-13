import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SuppressionDocument = HydratedDocument<Suppression>;

@Schema({ collection: 'suppressions', timestamps: true, versionKey: false })
export class Suppression {
  // Normalised E.164 mobile is the unique key
  @Prop({ required: true, unique: true, index: true })
  mobile: string;

  @Prop({ required: true })
  reason: string;

  @Prop({
    required: true,
    enum: ['keyword_opt_out', 'manual_admin', 'crm_flag'],
    default: 'manual_admin',
  })
  source: string;
}

export const SuppressionSchema = SchemaFactory.createForClass(Suppression);
