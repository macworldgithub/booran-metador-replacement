import { Controller, Post, Get, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { SmsService } from './sms.service';
import { InboundSmsDto } from './dto/inbound-sms.dto';
import { DeliveryReceiptDto } from './dto/delivery-receipt.dto';

@ApiTags('SMS Gateway & Webhooks')
@Controller('api/sms')
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  @Post('inbound')
  @ApiOperation({
    summary: 'Carrier webhook for incoming customer SMS',
    description:
      'Receives customer replies, appends them to the thread in <10s, handles STOP opt-outs, and pauses journey.',
  })
  @ApiResponse({ status: 201, description: 'SMS processed and appended to thread' })
  async handleInbound(@Body() dto: InboundSmsDto) {
    return this.smsService.processInboundSms(
      dto.from,
      dto.to,
      dto.body,
      dto.mediaUrls,
    );
  }

  @Post('delivery-receipt')
  @ApiOperation({ summary: 'Carrier delivery receipt status callback' })
  @ApiResponse({ status: 200, description: 'Message status updated' })
  async handleDeliveryReceipt(@Body() dto: DeliveryReceiptDto) {
    const updated = this.smsService.updateDeliveryStatus(
      dto.messageId,
      dto.status,
      dto.failureReason,
    );
    return { success: !!updated, event: updated };
  }

  @Get('segments')
  @ApiOperation({ summary: 'Calculate character count and GSM segments for composer' })
  @ApiQuery({ name: 'text', required: true, example: 'Hi John, thanks for enquiring...' })
  calculateSegments(@Query('text') text: string = '') {
    return this.smsService.calculateSegments(text);
  }
}
