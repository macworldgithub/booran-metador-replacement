import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { WritebackService } from './writeback.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/enums';

@ApiTags('DealerSocket CRM Write-Back')
@ApiBearerAuth()
@Roles(UserRole.GROUP_ADMIN, UserRole.SALES_MANAGER)
@Controller('api/writeback')
export class WritebackController {
  constructor(private readonly writebackService: WritebackService) {}

  @Get('logs')
  @ApiOperation({ summary: 'View DealerSocket activity write-back logs and statuses' })
  @ApiQuery({ name: 'status', enum: ['pending', 'success', 'failed'], required: false })
  @ApiResponse({ status: 200, description: 'List of sync logs' })
  async getLogs(@Query('status') status?: 'pending' | 'success' | 'failed') {
    return this.writebackService.getLogs(status);
  }

  @Post('retry/:id')
  @ApiOperation({ summary: 'Manually retry a failed DealerSocket write-back' })
  @ApiResponse({ status: 200, description: 'Retry initiated' })
  async retry(@Param('id') id: string) {
    const result = await this.writebackService.retryLog(id);
    return { success: !!result, log: result };
  }
}
