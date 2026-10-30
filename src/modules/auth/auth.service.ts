import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User } from '../database/schemas/user.schema';
import { UserRole, RooftopId } from '../../common/enums';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { MailService } from '../mail/mail.service';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
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

  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email.toLowerCase().trim();
    const user = await this.userModel.findOne({ email, isActive: true });

    if (!user) {
      // Return ambiguous message to prevent email enumeration
      return {
        message: 'If an account exists with that email, a password reset link has been sent.',
      };
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = expires;
    await user.save();

    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3001').replace(/\/$/, '');
    const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;

    this.logger.log(
      `\n========================================\nPASSWORD RESET LINK for ${user.email}:\n${resetUrl}\n========================================`,
    );

    // Send real email via SMTP
    await this.mailService.sendPasswordResetEmail(user.email, resetUrl, user.name);

    return {
      message: 'If an account exists with that email, a password reset link has been sent.',
      previewResetUrl: process.env.NODE_ENV !== 'production' ? resetUrl : undefined,
    };
  }

  async verifyResetToken(rawToken: string) {
    if (!rawToken || typeof rawToken !== 'string') {
      throw new BadRequestException('Reset token is required');
    }

    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    const user = await this.userModel.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() },
      isActive: true,
    }).lean();

    if (!user) {
      throw new BadRequestException('Invalid or expired password reset link');
    }

    return {
      valid: true,
      email: user.email,
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    if (!dto.token) {
      throw new BadRequestException('Reset token is required');
    }

    if (!dto.newPassword || dto.newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    const hashedToken = crypto.createHash('sha256').update(dto.token).digest('hex');
    const user = await this.userModel.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() },
      isActive: true,
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired password reset link');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    user.passwordHash = passwordHash;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();

    this.logger.log(`Password reset successfully for ${user.email}`);

    return {
      message: 'Password updated successfully. You can now sign in with your new password.',
    };
  }
}
