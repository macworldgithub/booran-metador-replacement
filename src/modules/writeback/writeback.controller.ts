import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { WritebackService } from './writeback.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/enums';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { PortalActor } from '../conversations/conversations.service';

@ApiTags('DealerSocket CRM Write-Back')
@ApiBearerAuth()
@Roles(UserRole.GROUP_ADMIN, UserRole.SALES_MANAGER)
@Controller('api/writeback')
export class WritebackController {
  constructor(private readonly writebackService: WritebackService) {}

  @Get('logs')
  @ApiOperation({
    summary: 'View DealerSocket activity write-back logs and statuses',
  })
  @ApiQuery({
    name: 'status',
    enum: ['pending', 'success', 'failed'],
    required: false,
  })
  @ApiResponse({ status: 200, description: 'List of sync logs' })
  async getLogs(
    @CurrentUser() user: PortalActor,
    @Query('status') status?: 'pending' | 'success' | 'failed',
  ) {
    return this.writebackService.getLogs(status, user);
  }

  @Post('retry/:id')
  @ApiOperation({ summary: 'Manually retry a failed DealerSocket write-back' })
  @ApiResponse({ status: 200, description: 'Retry initiated' })
  async retry(@Param('id') id: string, @CurrentUser() user: PortalActor) {
    const result = await this.writebackService.retryLog(id, user);
    return { success: !!result, log: result };
  }
  @Get('exceptions')
  @ApiOperation({
    summary:
      'Daily failed CRM write-back exception list scoped to authorised rooftops',
  })
  async exceptions(@CurrentUser() user: PortalActor) {
    return this.writebackService.getLogs('failed', user);
  }
}
