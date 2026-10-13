import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { UserRole, RooftopId } from '../../../common/enums';

export type UserDocument = HydratedDocument<User>;

@Schema({ collection: 'users', timestamps: true, versionKey: false })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true, index: true })
  email: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({
    required: true,
    enum: Object.values(UserRole),
    default: UserRole.SALESPERSON,
  })
  role: string;

  // Rooftops this user has access to (group_admin gets all by default)
  @Prop({ type: [String], enum: Object.values(RooftopId), default: [] })
  rooftopIds: string[];

  @Prop({ default: true })
  isActive: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);
