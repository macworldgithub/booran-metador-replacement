import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsEnum, IsOptional } from 'class-validator';
import { DeliveryStatus } from '../../../common/enums';

export class DeliveryReceiptDto {
  @ApiProperty({
    example: 'evt_123456789',
    description: 'Message or event ID',
  })
  @IsNotEmpty()
  @IsString()
  messageId: string;

  @ApiProperty({
    enum: DeliveryStatus,
    example: DeliveryStatus.DELIVERED,
    description: 'Updated delivery status',
  })
  @IsNotEmpty()
  @IsEnum(DeliveryStatus)
  status: DeliveryStatus;

  @ApiProperty({
    example: 'Carrier timeout / unreachable',
    required: false,
    description: 'Failure reason if status is failed',
  })
  @IsOptional()
  @IsString()
  failureReason?: string;
}
