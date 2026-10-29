import { Controller, Post, Get, Body, Query, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { SmsService } from './sms.service';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/enums';

@ApiTags('SMS Gateway & Webhooks')
@Controller('api/sms')
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  @Get('status')
  @Roles(UserRole.GROUP_ADMIN)
  @ApiOperation({
    summary: 'Read Mobile Message configuration and queue issues',
  })
  status() {
    return this.smsService.gatewayStatus();
  }

  @Public()
  @Post('inbound')
  @HttpCode(200)
  @ApiHeader({ name: 'x-mm-signature', required: true })
  @ApiHeader({ name: 'x-mm-timestamp', required: true })
  @ApiOperation({
    summary: 'Persist a signed Mobile Message reply or unsubscribe',
  })
  handleInbound(@Body() body: any) {
    return this.smsService.enqueueWebhook('inbound', body);
  }

  @Public()
  @Post('delivery-receipt')
  @HttpCode(200)
  @ApiHeader({ name: 'x-mm-signature', required: true })
  @ApiHeader({ name: 'x-mm-timestamp', required: true })
  @ApiOperation({ summary: 'Persist a signed Mobile Message delivery report' })
  handleDeliveryReceipt(@Body() body: any) {
    return this.smsService.enqueueWebhook('delivery', body);
  }

  @Get('segments')
  calculateSegments(@Query('text') text = '') {
    return this.smsService.calculateSegments(text);
  }
}
