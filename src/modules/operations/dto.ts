import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { RooftopId } from '../../common/enums';

export class RooftopSettingsDto {
  @ApiProperty() @IsString() @Matches(/\S/) @MaxLength(120) name: string;
  @ApiProperty() @IsString() @Matches(/\S/) @MaxLength(300) address: string;
  @ApiProperty({
    example: '+61488800209',
    description:
      'Provisioned dedicated receiving/sending mobile in E.164 format',
  })
  @Matches(/^\+614\d{8}$/)
  senderPhone: string;
  @ApiProperty({ example: '(03) 5995 0000' })
  @IsString()
  @Matches(/\S/)
  @MaxLength(40)
  displayPhone: string;
  @ApiProperty({ example: '09:00' })
  @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
  start: string;
  @ApiProperty({ example: '20:00' })
  @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
  end: string;
  @ApiProperty({ example: ['Sunday'] })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(6)
  @IsIn(
    [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ],
    { each: true },
  )
  closedDays: string[];
}
export class PlatformSettingsDto {
  @ApiPropertyOptional({
    description:
      'Forward-only cutover boundary. Leads received before this ISO timestamp are held for review.',
  })
  @IsOptional()
  @IsDateString()
  cutoverAt?: string;
  @ApiProperty({ default: 14 })
  @IsInt()
  @Min(1)
  @Max(90)
  duplicateWindowDays: number;
  @ApiProperty({ default: 24 })
  @IsInt()
  @Min(1)
  @Max(120)
  retentionMonths: number;
  @ApiProperty({
    default: false,
    description:
      'Enable retention removal only after the customer-record policy is approved',
  })
  @IsBoolean()
  retentionEnabled: boolean;
  @ApiProperty({
    example: [],
    description:
      'Empty permits all newly forwarded sources; a populated list restricts journey starts',
  })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  qualifyingSources: string[];
  @ApiProperty({
    default: false,
    description:
      'If true, new enquiries without an explicit recorded consent basis are held',
  })
  @IsBoolean()
  requireExplicitConsent: boolean;
  @ApiProperty({
    example: {},
    description:
      'Exact DealerSocket vendor/entity identifiers mapped to the three rooftop IDs',
  })
  @IsObject()
  entityMap: Record<string, RooftopId>;
}
export class JourneyStepDto {
  @ApiProperty({ example: 'Ack' })
  @IsString()
  @Matches(/\S/)
  @MaxLength(100)
  name: string;
  @ApiProperty({
    example: 'Hi {{firstName}}, thanks for enquiring about {{vehicleDesc}}.',
  })
  @IsString()
  @Matches(/\S/)
  @MaxLength(1400)
  template: string;
  @ApiProperty({
    enum: ['immediate', 'business_hours', 'next_morning', 'calendar_days'],
  })
  @IsIn(['immediate', 'business_hours', 'next_morning', 'calendar_days'])
  delayType: 'immediate' | 'business_hours' | 'next_morning' | 'calendar_days';
  @ApiProperty({ example: 4 }) @IsInt() @Min(0) @Max(168) delayValue: number;
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  requiresMarketingConsent?: boolean;
}
export class JourneyDraftDto {
  @ApiProperty({ enum: RooftopId }) @IsEnum(RooftopId) rooftopId: RooftopId;
  @ApiProperty({ example: 'new_vehicle_internet' })
  @Matches(/^[a-z][a-z0-9_]{0,49}$/)
  leadType: string;
  @ApiProperty({ example: 'Default new-lead journey' })
  @IsString()
  @Matches(/\S/)
  @MaxLength(120)
  name: string;
  @ApiProperty({ type: [JourneyStepDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => JourneyStepDto)
  steps: JourneyStepDto[];
}
export class TemplateDto {
  @ApiProperty({ enum: RooftopId }) @IsEnum(RooftopId) rooftopId: RooftopId;
  @ApiProperty() @IsString() @Matches(/\S/) @MaxLength(120) name: string;
  @ApiProperty() @IsString() @Matches(/\S/) @MaxLength(80) category: string;
  @ApiProperty() @IsString() @Matches(/\S/) @MaxLength(1400) content: string;
  @ApiProperty({ default: true }) @IsBoolean() active: boolean;
}
export class ReportQueryDto {
  @ApiPropertyOptional({ enum: RooftopId })
  @IsOptional()
  @IsEnum(RooftopId)
  rooftopId?: RooftopId;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}
export class TaskStatusDto {
  @ApiProperty({ enum: ['open', 'completed'] })
  @IsIn(['open', 'completed'])
  status: 'open' | 'completed';
}
export class ConsentDto {
  @ApiProperty() @IsBoolean() enquiryConsent: boolean;
  @ApiProperty() @IsBoolean() marketingConsent: boolean;
  @ApiProperty({
    description: 'Evidence/reference establishing consent or withdrawal',
  })
  @IsString()
  @Matches(/\S/)
  @MaxLength(1000)
  evidence: string;
}
