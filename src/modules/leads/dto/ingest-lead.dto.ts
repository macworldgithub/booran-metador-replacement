import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsEnum,
  IsOptional,
  ValidateNested,
  IsNumber,
  IsBoolean,
  IsDateString,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RooftopId } from '../../../common/enums';

export class LeadCustomerDto {
  @ApiProperty({ example: 'John', description: 'Customer first name' })
  @IsNotEmpty()
  @IsString()
  firstName: string;

  @ApiProperty({
    example: 'Smith',
    required: false,
    description: 'Customer last name',
  })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiProperty({
    example: '0412 345 678',
    description: 'Australian mobile number',
  })
  @IsNotEmpty()
  @IsString()
  mobile: string;

  @ApiProperty({ example: 'john.smith@example.com', required: false })
  @IsOptional()
  @IsString()
  email?: string;
}

export class LeadVehicleDto {
  @ApiProperty({ example: 'Kia', required: false })
  @IsOptional()
  @IsString()
  make?: string;

  @ApiProperty({ example: 'Sportage GT-Line', required: false })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiProperty({ example: 2026, required: false })
  @IsOptional()
  @IsNumber()
  year?: number;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  isNew?: boolean;

  @ApiProperty({ example: 'STOCK-8891', required: false })
  @IsOptional()
  @IsString()
  stockNumber?: string;

  @ApiProperty({
    example: 'Customer wants drive-away pricing with sunroof',
    required: false,
  })
  @IsOptional()
  @IsString()
  comments?: string;
}

export class LeadSalespersonDto {
  @ApiProperty({ example: 'David Miller', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ example: 'david.m@booran.com.au', required: false })
  @IsOptional()
  @IsString()
  email?: string;
}

export class IngestLeadDto {
  @ApiProperty({ required: false, default: 'new_vehicle_internet' })
  @IsOptional()
  @Matches(/^[a-z][a-z0-9_]{0,49}$/)
  leadType?: string;
  @ApiProperty({
    required: false,
    default: true,
    description: 'False rejects historical replays rather than enrolling them',
  })
  @IsOptional()
  @IsBoolean()
  isNewLead?: boolean;
  @ApiProperty({
    required: false,
    description:
      'Explicit enquiry consent; absent defaults to enquiry response unless strict consent is enabled',
  })
  @IsOptional()
  @IsBoolean()
  enquiryConsent?: boolean;
  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;
  @ApiProperty({ required: false, description: 'Consent evidence/reference' })
  @IsOptional()
  @IsString()
  consentEvidence?: string;
  @ApiProperty({
    example: 'DS-OPP-99281',
    description: 'DealerSocket Opportunity ID (System of Record identifier)',
  })
  @IsNotEmpty()
  @IsString()
  dealerSocketOpportunityId: string;

  @ApiProperty({
    example: 'DS-CUST-44120',
    required: false,
    description: 'DealerSocket Customer ID',
  })
  @IsOptional()
  @IsString()
  dealerSocketCustomerId?: string;

  @ApiProperty({
    enum: RooftopId,
    example: RooftopId.CRANBOURNE_KIA,
    description:
      'Rooftop entity (Cranbourne Kia, Cranbourne MG, Geely Cranbourne)',
  })
  @IsNotEmpty()
  @IsEnum(RooftopId)
  rooftopId: RooftopId;

  @ApiProperty({ type: LeadCustomerDto })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => LeadCustomerDto)
  customer: LeadCustomerDto;

  @ApiProperty({ type: LeadVehicleDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => LeadVehicleDto)
  vehicle?: LeadVehicleDto;

  @ApiProperty({
    example: 'carsales',
    description: 'Lead source (e.g. carsales, website, fb, walk-in)',
  })
  @IsNotEmpty()
  @IsString()
  leadSource: string;

  @ApiProperty({ type: LeadSalespersonDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => LeadSalespersonDto)
  salesperson?: LeadSalespersonDto;

  @ApiProperty({ example: '2026-10-12T16:00:00Z', required: false })
  @IsOptional()
  @IsDateString()
  receivedAt?: string;
}
