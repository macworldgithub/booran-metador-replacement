import { IsEmail, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'admin@booran.com.au' })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}
