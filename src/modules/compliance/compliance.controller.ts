import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ComplianceService } from './compliance.service';
import { AddSuppressionDto } from './dto/add-suppression.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/enums';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { PortalActor } from '../conversations/conversations.service';
import { PhoneNormalizer } from '../../common/utils/phone-normalizer.util';

@ApiTags('Compliance & Suppression')
@ApiBearerAuth()
@Roles(UserRole.GROUP_ADMIN)
@Controller('api/compliance')
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Get('suppressions')
  @ApiOperation({
    summary: 'List all numbers on the shared 3-rooftop suppression list',
  })
  @ApiResponse({ status: 200, description: 'Active opt-outs and suppressions' })
  getSuppressions() {
    return this.complianceService.getAllSuppressions();
  }

  @Post('suppress')
  @ApiOperation({
    summary: 'Add a number to the global 3-rooftop suppression list',
  })
  @ApiResponse({ status: 201, description: 'Number added to suppression list' })
  addSuppression(
    @Body() dto: AddSuppressionDto,
    @CurrentUser() user: PortalActor,
  ) {
    return this.complianceService.addSuppression(
      dto.mobile,
      dto.reason,
      dto.source,
      user,
    );
  }

  @Delete('suppress/:mobile')
  @ApiOperation({
    summary: 'Remove a number from the suppression list (admin override)',
  })
  @ApiParam({ name: 'mobile', example: '+61412345678' })
  @ApiResponse({ status: 200, description: 'Removed from suppression list' })
  async removeSuppression(
    @Param('mobile') mobile: string,
    @CurrentUser() user: PortalActor,
  ) {
    const success = await this.complianceService.removeSuppression(
      mobile,
      user,
    );
    return {
      success,
      mobile: PhoneNormalizer.normalizeAustralianPhone(mobile).normalized,
    };
  }

  @Get('audit')
  @ApiOperation({ summary: 'Export ACMA & Spam Act audit compliance summary' })
  @ApiResponse({ status: 200, description: 'Compliance audit summary' })
  getAuditLog() {
    return this.complianceService.getAuditLog();
  }
}
