import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User } from '../database/schemas/user.schema';
import { RooftopId, UserRole } from '../../common/enums';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<User>) {}

  private sanitize(user: any) {
    const { passwordHash, __v, ...rest } = user;
    return { id: rest._id?.toString() ?? rest.id, ...rest };
  }

  async findAll() {
    const users = await this.userModel
      .find()
      .select('-passwordHash')
      .sort({ createdAt: -1 })
      .lean();
    return users.map(this.sanitize);
  }

  async findById(id: string) {
    const user = await this.userModel.findById(id).select('-passwordHash').lean();
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return this.sanitize(user);
  }

  async create(dto: CreateUserDto) {
    const existing = await this.userModel.findOne({ email: dto.email.toLowerCase() });
    if (existing) throw new ConflictException(`Email ${dto.email} is already registered`);

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const created = await this.userModel.create({
      email: dto.email.toLowerCase(),
      passwordHash,
      name: dto.name,
      role: dto.role,
      rooftopIds: dto.rooftopIds ?? [],
      isActive: true,
    });

    const { passwordHash: _ph, ...safe } = created.toObject() as any;
    return { id: safe._id.toString(), ...safe };
  }

  async updateRole(id: string, role: UserRole) {
    const user = await this.userModel
      .findByIdAndUpdate(id, { role }, { new: true })
      .select('-passwordHash')
      .lean();
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return this.sanitize(user);
  }

  async assignRooftops(id: string, rooftopIds: RooftopId[]) {
    const user = await this.userModel
      .findByIdAndUpdate(id, { rooftopIds }, { new: true })
      .select('-passwordHash')
      .lean();
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return this.sanitize(user);
  }

  async deactivate(id: string) {
    const user = await this.userModel
      .findByIdAndUpdate(id, { isActive: false }, { new: true })
      .select('-passwordHash')
      .lean();
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return { message: `User ${id} deactivated`, user: this.sanitize(user) };
  }

  async resetPassword(id: string, newPassword: string) {
    if (newPassword.length < 8)
      throw new BadRequestException('Password must be at least 8 characters');
    const passwordHash = await bcrypt.hash(newPassword, 12);
    const user = await this.userModel.findByIdAndUpdate(id, { passwordHash }, { new: true }).lean();
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return { message: 'Password updated successfully' };
  }
}
