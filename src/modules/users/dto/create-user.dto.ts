import {
  IsEmail,
  IsEnum,
  IsArray,
  IsString,
  IsNotEmpty,
  MinLength,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole, RooftopId } from '../../../common/enums';

export class CreateUserDto {
  @ApiProperty({ example: 'john.smith@booran.com.au' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'John Smith' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Password@123', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ enum: UserRole, example: UserRole.SALESPERSON })
  @IsEnum(UserRole)
  role: UserRole;

  @ApiPropertyOptional({
    type: [String],
    enum: RooftopId,
    example: [RooftopId.CRANBOURNE_KIA],
  })
  @IsOptional()
  @IsArray()
  @IsEnum(RooftopId, { each: true })
  rooftopIds?: RooftopId[];
}
