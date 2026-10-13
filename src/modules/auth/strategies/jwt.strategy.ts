import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../../database/schemas/user.schema';

export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  role: string;
  rooftopIds: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(@InjectModel(User.name) private readonly userModel: Model<User>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'fallback-dev-secret',
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.userModel.findOne({ _id: payload.sub, isActive: true }).lean();
    if (!user) {
      throw new UnauthorizedException('User account not found or deactivated');
    }
    // Return value is attached to request.user
    return {
      id: (user as any)._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      rooftopIds: user.rooftopIds,
    };
  }
}
