import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsEnum,
  Matches,
  MaxLength,
  IsEmail,
  IsDateString,
  IsIn,
  ValidateIf,
} from 'class-validator';
import {
  RooftopId,
  ProspectStatus,
  JourneyAction,
  ProspectOutcome,
} from '../../../common/enums';

export class QueryProspectsDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() source?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  landedFrom?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  landedTo?: string;
  @ApiProperty({ required: false, enum: ['mine', 'unassigned'] })
  @IsOptional()
  @IsIn(['mine', 'unassigned'])
  ownership?: 'mine' | 'unassigned';
  @ApiProperty({ enum: RooftopId, required: false })
  @IsOptional()
  @IsEnum(RooftopId)
  rooftopId?: RooftopId;

  @ApiProperty({ enum: ProspectStatus, required: false })
  @IsOptional()
  @IsEnum(ProspectStatus)
  status?: ProspectStatus;

  @ApiProperty({
    required: false,
    description: 'Filter by owner/salesperson name',
  })
  @IsOptional()
  @IsString()
  ownerName?: string;

  @ApiProperty({
    required: false,
    description: 'Search name, mobile, vehicle, or opp ID',
  })
  @IsOptional()
  @IsString()
  search?: string;
}

export class SendStaffMessageDto {
  @ApiProperty({
    required: false,
    description:
      'Active template ID. Merge fields are rendered for this prospect.',
  })
  @IsOptional()
  @IsString()
  templateId?: string;
  @ApiProperty({
    example:
      'Hi John, I can have the Sportage ready for you at 2pm today. Cheers, David.',
  })
  @ValidateIf((dto) => !dto.templateId)
  @IsNotEmpty()
  @IsString()
  @Matches(/\S/, { message: 'content must not be blank' })
  @MaxLength(1600)
  content: string;

  @ApiProperty({
    example: 'David Miller',
    description: 'Staff user composing the message',
  })
  @IsOptional()
  @IsString()
  authorName: string;
}

export class AddInternalNoteDto {
  @ApiProperty({
    example: 'Customer mentioned trade-in valuation needed on 2018 Mazda 3.',
  })
  @IsNotEmpty()
  @IsString()
  @Matches(/\S/, { message: 'content must not be blank' })
  @MaxLength(10000)
  content: string;

  @ApiProperty({
    example: 'Sarah Jenkins',
    description: 'BDC / Sales consultant adding note',
  })
  @IsOptional()
  @IsString()
  authorName: string;
}

export class UpdateJourneyDto {
  @ApiProperty({ enum: JourneyAction, example: JourneyAction.PAUSE })
  @IsNotEmpty()
  @IsEnum(JourneyAction)
  action: JourneyAction;

  @ApiProperty({
    example: 'Speaking directly with customer over phone',
    required: false,
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class SetOutcomeDto {
  @ApiProperty({
    enum: ProspectOutcome,
    example: ProspectOutcome.APPOINTMENT_REQUESTED,
  })
  @IsNotEmpty()
  @IsEnum(ProspectOutcome)
  outcome: ProspectOutcome;

  @ApiProperty({
    example: 'Test drive booked for Saturday 11:00 AM',
    required: false,
  })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class AssignProspectDto {
  @ApiProperty({ example: 'David Miller' })
  @IsNotEmpty()
  @IsString()
  @Matches(/\S/, { message: 'salespersonName must not be blank' })
  salespersonName: string;

  @ApiProperty({ example: 'david.m@booran.com.au', required: false })
  @IsOptional()
  @IsEmail()
  salespersonEmail?: string;
}
