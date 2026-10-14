import {
  Injectable,
  UnauthorizedException,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User } from '../database/schemas/user.schema';
import { UserRole, RooftopId } from '../../common/enums';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly jwtService: JwtService,
  ) {}

  /** Seeds the default Group Admin account on first run */
  async onModuleInit() {
    const count = await this.userModel.countDocuments();
    if (count === 0) {
      const email = process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@booran.com.au';
      const password =
        process.env.BOOTSTRAP_ADMIN_PASSWORD ||
        (process.env.NODE_ENV === 'production' ? '' : 'Admin@2026!');
      if (process.env.NODE_ENV === 'production' && password.length < 12)
        throw new Error(
          'Configure BOOTSTRAP_ADMIN_PASSWORD with at least 12 characters before first production startup',
        );
      const passwordHash = await bcrypt.hash(password, 12);
      await this.userModel.create({
        email,
        passwordHash,
        name: 'Group Admin',
        role: UserRole.GROUP_ADMIN,
        rooftopIds: Object.values(RooftopId),
        isActive: true,
      });
      this.logger.log(
        'Initial Group Admin created. Credentials are not logged.',
      );
    }
  }

  async login(dto: LoginDto) {
    const user = await this.userModel
      .findOne({ email: dto.email.toLowerCase(), isActive: true })
      .lean();

    if (!user) throw new UnauthorizedException('Invalid email or password');

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatch)
      throw new UnauthorizedException('Invalid email or password');

    const payload = {
      sub: (user as any)._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      rooftopIds: user.rooftopIds,
    };

    const token = this.jwtService.sign(payload);

    return {
      accessToken: token,
      tokenType: 'Bearer',
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
      user: {
        id: (user as any)._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
        rooftopIds: user.rooftopIds,
      },
    };
  }

  async getProfile(userId: string) {
    const user = await this.userModel
      .findById(userId)
      .select('-passwordHash')
      .lean();
    if (!user) throw new UnauthorizedException('User not found');
    return {
      id: (user as any)._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      rooftopIds: user.rooftopIds,
      isActive: user.isActive,
    };
  }
}
