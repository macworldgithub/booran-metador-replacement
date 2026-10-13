import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'admin@booran.com.au' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Admin@2026!' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;
}
