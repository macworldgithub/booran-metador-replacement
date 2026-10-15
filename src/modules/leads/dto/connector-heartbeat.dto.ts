import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class ConnectorHeartbeatDto {
  @ApiProperty({ example: 'dealersocket-chrome-1' })
  @IsString()
  @MaxLength(100)
  workerId: string;

  @ApiProperty({ example: '1.0.0' })
  @IsString()
  @MaxLength(30)
  workerVersion: string;

  @ApiProperty({ enum: ['healthy', 'degraded', 'failed'] })
  @IsIn(['healthy', 'degraded', 'failed'])
  status: 'healthy' | 'degraded' | 'failed';

  @ApiProperty()
  @IsDateString()
  pollStartedAt: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  pollCompletedAt?: string;

  @ApiProperty({ minimum: 30 })
  @IsInt()
  @Min(30)
  intervalSeconds: number;

  @ApiProperty() @IsInt() @Min(0) filtersRead: number;
  @ApiProperty() @IsInt() @Min(0) recordsSeen: number;
  @ApiProperty() @IsInt() @Min(0) recordsChanged: number;
  @ApiProperty() @IsInt() @Min(0) recordsSent: number;
  @ApiProperty() @IsInt() @Min(0) errors: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  lastError?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  baselineCompletedAt?: string;

  @ApiProperty({ default: true })
  @IsBoolean()
  readOnly: boolean;
}
