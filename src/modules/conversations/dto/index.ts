import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional, IsEnum } from 'class-validator';
import {
  RooftopId,
  ProspectStatus,
  JourneyAction,
  ProspectOutcome,
} from '../../../common/enums';

export class QueryProspectsDto {
  @ApiProperty({ enum: RooftopId, required: false })
  @IsOptional()
  @IsEnum(RooftopId)
  rooftopId?: RooftopId;

  @ApiProperty({ enum: ProspectStatus, required: false })
  @IsOptional()
  @IsEnum(ProspectStatus)
  status?: ProspectStatus;

  @ApiProperty({ required: false, description: 'Filter by owner/salesperson name' })
  @IsOptional()
  @IsString()
  ownerName?: string;

  @ApiProperty({ required: false, description: 'Search name, mobile, vehicle, or opp ID' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class SendStaffMessageDto {
  @ApiProperty({ example: 'Hi John, I can have the Sportage ready for you at 2pm today. Cheers, David.' })
  @IsNotEmpty()
  @IsString()
  content: string;

  @ApiProperty({ example: 'David Miller', description: 'Staff user composing the message' })
  @IsNotEmpty()
  @IsString()
  authorName: string;
}

export class AddInternalNoteDto {
  @ApiProperty({ example: 'Customer mentioned trade-in valuation needed on 2018 Mazda 3.' })
  @IsNotEmpty()
  @IsString()
  content: string;

  @ApiProperty({ example: 'Sarah Jenkins', description: 'BDC / Sales consultant adding note' })
  @IsNotEmpty()
  @IsString()
  authorName: string;
}

export class UpdateJourneyDto {
  @ApiProperty({ enum: JourneyAction, example: JourneyAction.PAUSE })
  @IsNotEmpty()
  @IsEnum(JourneyAction)
  action: JourneyAction;

  @ApiProperty({ example: 'Speaking directly with customer over phone', required: false })
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

  @ApiProperty({ example: 'Test drive booked for Saturday 11:00 AM', required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class AssignProspectDto {
  @ApiProperty({ example: 'David Miller' })
  @IsNotEmpty()
  @IsString()
  salespersonName: string;

  @ApiProperty({ example: 'david.m@booran.com.au', required: false })
  @IsOptional()
  @IsString()
  salespersonEmail?: string;
}
