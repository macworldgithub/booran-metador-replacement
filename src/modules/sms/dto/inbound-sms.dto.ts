import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional, IsArray } from 'class-validator';

export class InboundSmsDto {
  @ApiProperty({
    example: '0412345678',
    description: 'Sender customer mobile number',
  })
  @IsNotEmpty()
  @IsString()
  from: string;

  @ApiProperty({
    example: '+61488800209',
    description:
      'Rooftop incoming number (+61488800209 for Cranbourne Kia, etc.)',
  })
  @IsNotEmpty()
  @IsString()
  to: string;

  @ApiProperty({
    example: 'Hi, is the Kia Sportage still available?',
    description: 'SMS message text',
  })
  @IsNotEmpty()
  @IsString()
  body: string;

  @ApiProperty({
    example: 'msg_987654321',
    required: false,
    description: 'Carrier message ID',
  })
  @IsOptional()
  @IsString()
  messageId?: string;

  @ApiProperty({
    example: ['https://carrier-media.com/mms1.jpg'],
    required: false,
    type: [String],
    description: 'Optional MMS media attachment URLs',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaUrls?: string[];
}
