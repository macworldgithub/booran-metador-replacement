import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole, RooftopId } from '../../common/enums';
import { IsArray, IsEnum, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class AssignRooftopsDto {
  @ApiProperty({ type: [String], enum: RooftopId })
  @IsArray()
  @IsEnum(RooftopId, { each: true })
  rooftopIds: RooftopId[];
}

class ResetPasswordDto {
  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword: string;
}

class UpdateRoleDto {
  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole)
  role: UserRole;
}

@ApiTags('Users (Group Admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.GROUP_ADMIN)
@Controller('api/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List all portal users' })
  @ApiResponse({ status: 200, description: 'All users excluding password hashes' })
  findAll() {
    return this.usersService.findAll();
  }

  @Post()
  @ApiOperation({ summary: 'Create a new portal user' })
  @ApiResponse({ status: 201, description: 'User created' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single user by ID' })
  @ApiParam({ name: 'id', description: 'User MongoDB ID' })
  findOne(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Patch(':id/role')
  @ApiOperation({ summary: 'Update user role' })
  @ApiParam({ name: 'id', description: 'User MongoDB ID' })
  updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.usersService.updateRole(id, dto.role);
  }

  @Patch(':id/rooftops')
  @ApiOperation({ summary: 'Assign rooftop access to a user' })
  @ApiParam({ name: 'id', description: 'User MongoDB ID' })
  assignRooftops(@Param('id') id: string, @Body() dto: AssignRooftopsDto) {
    return this.usersService.assignRooftops(id, dto.rooftopIds);
  }

  @Patch(':id/password')
  @ApiOperation({ summary: 'Reset a user password (admin only)' })
  @ApiParam({ name: 'id', description: 'User MongoDB ID' })
  resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto) {
    return this.usersService.resetPassword(id, dto.newPassword);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate a user (soft delete)' })
  @ApiParam({ name: 'id', description: 'User MongoDB ID' })
  deactivate(@Param('id') id: string) {
    return this.usersService.deactivate(id);
  }
}
