import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsIn,
  Matches,
  MaxLength,
} from 'class-validator';

export class AddSuppressionDto {
  @ApiProperty({
    example: '0412345678',
    description: 'Australian mobile number to suppress across all 3 rooftops',
  })
  @IsNotEmpty()
  @IsString()
  mobile: string;

  @ApiProperty({
    example: 'Customer requested manual unsubscribe over phone',
    description: 'Reason for suppression',
  })
  @IsNotEmpty()
  @IsString()
  @Matches(/\S/)
  @MaxLength(1000)
  reason: string;

  @ApiProperty({
    example: 'manual_admin',
    enum: ['manual_admin', 'keyword_opt_out', 'crm_flag'],
    required: false,
  })
  @IsOptional()
  @IsIn(['manual_admin', 'keyword_opt_out', 'crm_flag'])
  source?: 'manual_admin' | 'keyword_opt_out' | 'crm_flag';
}
