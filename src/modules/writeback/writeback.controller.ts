import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { WritebackService } from './writeback.service';

@ApiTags('DealerSocket CRM Write-Back')
@Controller('api/writeback')
export class WritebackController {
  constructor(private readonly writebackService: WritebackService) {}

  @Get('logs')
  @ApiOperation({ summary: 'View DealerSocket activity write-back logs and statuses' })
  @ApiQuery({ name: 'status', enum: ['pending', 'success', 'failed'], required: false })
  @ApiResponse({ status: 200, description: 'List of sync logs' })
  getLogs(@Query('status') status?: 'pending' | 'success' | 'failed') {
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
