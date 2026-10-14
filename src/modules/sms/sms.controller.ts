import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  BadRequestException,
  HttpCode,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBody,
  ApiSecurity,
  ApiHeader,
} from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SmsService } from './sms.service';
import { InboundSmsDto } from './dto/inbound-sms.dto';
import { DeliveryReceiptDto } from './dto/delivery-receipt.dto';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('SMS Gateway & Webhooks')
@Controller('api/sms')
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  @Public()
  @Post('inbound')
  @ApiSecurity('webhookTest')
  @ApiHeader({
    name: 'x-twilio-signature',
    required: false,
    description:
      'Required for live carrier requests; verified against WEBHOOK_PUBLIC_BASE_URL',
  })
  @ApiBody({
    type: InboundSmsDto,
    description:
      'Accepts normalized JSON or native Twilio form fields From, To, Body, MessageSid, NumMedia and MediaUrlN',
  })
  @ApiOperation({
    summary: 'Carrier webhook for incoming customer SMS',
    description:
      'Receives customer replies, appends them to the thread in <10s, handles STOP opt-outs, and pauses journey.',
  })
  @ApiResponse({
    status: 201,
    description: 'SMS processed and appended to thread',
  })
  async handleInbound(
    @Body() body: any,
    @Res({ passthrough: true }) response: Response,
  ) {
    const media =
      body.mediaUrls ??
      Array.from(
        { length: Math.min(Number(body.NumMedia) || 0, 10) },
        (_, i) => body[`MediaUrl${i}`],
      ).filter(Boolean);
    const dto = plainToInstance(InboundSmsDto, {
      from: body.from ?? body.From,
      to: body.to ?? body.To,
      body:
        (body.body ?? body.Body) || (media.length ? '[MMS attachment]' : ''),
      messageId: body.messageId ?? body.MessageSid,
      mediaUrls: media,
    });
    const errors = await validate(dto);
    if (errors.length)
      throw new BadRequestException(
        errors.flatMap((error) => Object.values(error.constraints ?? {})),
      );
    const result = await this.smsService.processInboundSms(
      dto.from,
      dto.to,
      dto.body,
      dto.mediaUrls,
      dto.messageId,
    );
    if (body.From) {
      response.status(200).type('text/xml');
      return '<Response></Response>';
    }
    return result;
  }

  @Public()
  @Post('delivery-receipt')
  @HttpCode(200)
  @ApiSecurity('webhookTest')
  @ApiHeader({ name: 'x-twilio-signature', required: false })
  @ApiBody({
    type: DeliveryReceiptDto,
    description:
      'Accepts normalized JSON or native Twilio MessageSid, MessageStatus and ErrorCode/ErrorMessage',
  })
  @ApiOperation({ summary: 'Carrier delivery receipt status callback' })
  @ApiResponse({ status: 200, description: 'Message status updated' })
  async handleDeliveryReceipt(@Body() body: any) {
    const raw = body.status ?? body.MessageStatus;
    const status = ['accepted', 'queued', 'sending', 'sent'].includes(raw)
      ? 'pending'
      : ['undelivered', 'canceled'].includes(raw)
        ? 'failed'
        : raw;
    const dto = plainToInstance(DeliveryReceiptDto, {
      messageId: body.messageId ?? body.MessageSid,
      status,
      failureReason:
        body.failureReason ??
        body.ErrorMessage ??
        (body.ErrorCode ? `Carrier error ${body.ErrorCode}` : undefined),
    });
    const errors = await validate(dto);
    if (errors.length)
      throw new BadRequestException(
        errors.flatMap((error) => Object.values(error.constraints ?? {})),
      );
    const updated = await this.smsService.updateDeliveryStatus(
      dto.messageId,
      dto.status,
      dto.failureReason,
    );
    return { success: !!updated, event: updated };
  }

  @Get('segments')
  @ApiOperation({
    summary: 'Calculate character count and GSM segments for composer',
  })
  @ApiQuery({
    name: 'text',
    required: true,
    example: 'Hi John, thanks for enquiring...',
  })
  calculateSegments(@Query('text') text: string = '') {
    return this.smsService.calculateSegments(text);
  }
}
