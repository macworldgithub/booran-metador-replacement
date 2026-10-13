import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { ComplianceService } from './compliance.service';
import { AddSuppressionDto } from './dto/add-suppression.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/enums';

@ApiTags('Compliance & Suppression')
@ApiBearerAuth()
@Roles(UserRole.GROUP_ADMIN)
@Controller('api/compliance')
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Get('suppressions')
  @ApiOperation({ summary: 'List all numbers on the shared 3-rooftop suppression list' })
  @ApiResponse({ status: 200, description: 'Active opt-outs and suppressions' })
  getSuppressions() {
    return this.complianceService.getAllSuppressions();
  }

  @Post('suppress')
  @ApiOperation({ summary: 'Add a number to the global 3-rooftop suppression list' })
  @ApiResponse({ status: 201, description: 'Number added to suppression list' })
  addSuppression(@Body() dto: AddSuppressionDto) {
    return this.complianceService.addSuppression(dto.mobile, dto.reason, dto.source);
  }

  @Delete('suppress/:mobile')
  @ApiOperation({ summary: 'Remove a number from the suppression list (admin override)' })
  @ApiParam({ name: 'mobile', example: '+61412345678' })
  @ApiResponse({ status: 200, description: 'Removed from suppression list' })
  removeSuppression(@Param('mobile') mobile: string) {
    const success = this.complianceService.removeSuppression(mobile);
    return { success, mobile };
  }

  @Get('audit')
  @ApiOperation({ summary: 'Export ACMA & Spam Act audit compliance summary' })
  @ApiResponse({ status: 200, description: 'Compliance audit summary' })
  getAuditLog() {
    return this.complianceService.getAuditLog();
  }
}
