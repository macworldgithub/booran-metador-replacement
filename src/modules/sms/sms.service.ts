import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { StoreService } from '../database/store.service';
import { ComplianceService } from '../compliance/compliance.service';
import { PhoneNormalizer } from '../../common/utils/phone-normalizer.util';
import {
  ThreadEventType,
  DeliveryStatus,
  ProspectStatus,
  RooftopId,
} from '../../common/enums';
import { ThreadEventEntity, ProspectEntity } from '../database/entities';

import twilio = require('twilio');

export interface SendSmsOptions {
  prospect: ProspectEntity;
  content: string;
  type: ThreadEventType.AUTOMATED_OUTBOUND | ThreadEventType.STAFF_OUTBOUND;
  authorName?: string;
  journeyStepName?: string;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly twilioClient?: twilio.Twilio;

  constructor(
    private readonly store: StoreService,
    private readonly complianceService: ComplianceService,
  ) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (accountSid && authToken && !accountSid.startsWith('ACxxx')) {
      try {
        this.twilioClient = twilio(accountSid, authToken);
        this.logger.log('Twilio SMS client initialized successfully');
      } catch (err: any) {
        this.logger.warn(`Failed to initialize Twilio client: ${err.message}`);
      }
    } else {
      this.logger.log(
        'Twilio credentials not configured. Running SMS service in simulation mode.',
      );
    }
  }

  calculateSegments(text: string) {
    const isUnicode = /[^\u0000-\u007F]/.test(text);
    const charCount = text.length;
    const segmentLimit = isUnicode ? 70 : 160;
    const multiLimit = isUnicode ? 67 : 153;
    const segments =
      charCount === 0
        ? 1
        : charCount <= segmentLimit
          ? 1
          : Math.ceil(charCount / multiLimit);
    return { charCount, segments, isUnicode, maxSingleSegment: segmentLimit };
  }

  async sendOutboundSms(options: SendSmsOptions): Promise<ThreadEventEntity> {
    const { prospect, content, type, authorName, journeyStepName } = options;

    // Suppression check
    const suppressed = await this.complianceService.isMobileSuppressed(
      prospect.normalizedMobile,
    );
    if (suppressed) {
      this.logger.warn(
        `Blocked send to suppressed mobile ${prospect.normalizedMobile}`,
      );
      throw new BadRequestException(
        `Mobile ${prospect.normalizedMobile} is in the 3-rooftop suppression list`,
      );
    }

    const rooftop = this.store.getRooftopById(prospect.rooftopId);
    if (!rooftop)
      throw new NotFoundException(`Rooftop not found: ${prospect.rooftopId}`);

    let externalSid: string | undefined;
    let initialStatus = DeliveryStatus.DELIVERED;
    let failureReason: string | undefined;

    // Dispatch via real Twilio if credentials configured
    if (this.twilioClient) {
      try {
        const message = await this.twilioClient.messages.create({
          body: content,
          from: rooftop.senderPhone,
          to: prospect.normalizedMobile,
          statusCallback: process.env.TWILIO_STATUS_CALLBACK_URL || undefined,
        });
        externalSid = message.sid;
        initialStatus = DeliveryStatus.PENDING;
        this.logger.log(
          `Twilio message created [SID: ${message.sid}] status: ${message.status}`,
        );
      } catch (twilioErr: any) {
        this.logger.error(
          `Twilio send failed to ${prospect.normalizedMobile}: ${twilioErr.message}`,
          twilioErr.stack,
        );
        initialStatus = DeliveryStatus.FAILED;
        failureReason = twilioErr.message || 'Carrier rejected the message';
      }
    }

    const eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const event: ThreadEventEntity = {
      id: eventId,
      prospectId: prospect.id,
      type,
      direction: 'outbound',
      content,
      authorName,
      journeyStepName,
      deliveryStatus: initialStatus,
      failureReason,
      timestamp: new Date(),
      metadata: {
        from: rooftop.senderPhone,
        to: prospect.normalizedMobile,
        rooftopName: rooftop.name,
        twilioMessageSid: externalSid,
        simulated: !this.twilioClient,
      },
    };

    await this.store.addEvent(event);
    this.logger.log(
      `[SMS OUT] ${rooftop.name} -> ${prospect.normalizedMobile} (${type}): "${content}"`,
    );

    // Staff send → pause automated journey (Scope §7.2)
    if (type === ThreadEventType.STAFF_OUTBOUND) {
      await this.store.updateProspect(prospect.id, {
        status:
          initialStatus === DeliveryStatus.FAILED
            ? ProspectStatus.WAITING_ON_US
            : ProspectStatus.WAITING_ON_CUSTOMER,
        journey: {
          ...prospect.journey,
          status: 'paused',
          pausedReason: `Staff send by ${authorName || 'User'}`,
        },
      });

      await this.store.addEvent({
        id: `sys_${Date.now()}`,
        prospectId: prospect.id,
        type: ThreadEventType.SYSTEM,
        direction: 'internal',
        content: `Automated journey paused due to staff message sent by ${authorName || 'Staff'}.`,
        timestamp: new Date(),
      });
    }

    return event;
  }

  async processInboundSms(
    from: string,
    to: string,
    body: string,
    mediaUrls?: string[],
  ): Promise<{ event: ThreadEventEntity; isOptOut: boolean }> {
    const normFrom = PhoneNormalizer.normalizeAustralianPhone(from);
    if (!normFrom.isValid || !normFrom.normalized) {
      throw new BadRequestException(`Invalid Australian sender phone: ${from}`);
    }

    const targetRooftop = this.store.getRooftopBySenderPhone(to);
    const rooftopId = targetRooftop
      ? targetRooftop.id
      : RooftopId.CRANBOURNE_KIA;

    // Find prospect within 30-day window
    let prospect = await this.store.findRecentProspectByMobileAndRooftop(
      normFrom.normalized,
      rooftopId,
      30,
    );

    // Fallback: search across rooftops
    if (!prospect) {
      const allProspects = await this.store.queryProspects({
        search: normFrom.normalized,
      });
      prospect = allProspects[0] || null;
    }

    if (!prospect) {
      throw new NotFoundException(
        `No open prospect found for mobile ${normFrom.normalized} at rooftop ${rooftopId}`,
      );
    }

    const isOptOut = PhoneNormalizer.isOptOutKeyword(body);

    if (isOptOut) {
      await this.complianceService.addSuppression(
        normFrom.normalized,
        `Opt-out keyword received: ${body.trim()}`,
        'keyword_opt_out',
      );

      const inboundEvent: ThreadEventEntity = {
        id: `evt_in_${Date.now()}`,
        prospectId: prospect.id,
        type: ThreadEventType.CUSTOMER_INBOUND,
        direction: 'inbound',
        content: body,
        mediaUrls,
        timestamp: new Date(),
      };
      await this.store.addEvent(inboundEvent);

      await this.store.addEvent({
        id: `sys_${Date.now()}`,
        prospectId: prospect.id,
        type: ThreadEventType.SYSTEM,
        direction: 'internal',
        content: `Customer unsubscribed (${body.trim()}). Number added to 3-rooftop global suppression list.`,
        timestamp: new Date(),
      });

      await this.store.updateProspect(prospect.id, {
        status: ProspectStatus.OPTED_OUT,
        journey: {
          ...prospect.journey,
          status: 'stopped',
          pausedReason: 'Customer opted out with STOP keyword',
        },
      });

      const rooftop = this.store.getRooftopById(prospect.rooftopId);
      const rooftopName = rooftop ? rooftop.name : 'Dealership';
      await this.store.addEvent({
        id: `evt_optout_conf_${Date.now()}`,
        prospectId: prospect.id,
        type: ThreadEventType.AUTOMATED_OUTBOUND,
        direction: 'outbound',
        content: `${rooftopName}: You have successfully unsubscribed. No further messages will be sent.`,
        journeyStepName: 'Opt-out Confirmation',
        deliveryStatus: DeliveryStatus.DELIVERED,
        timestamp: new Date(),
      });

      return { event: inboundEvent, isOptOut: true };
    }

    // Normal inbound reply
    const inboundEvent: ThreadEventEntity = {
      id: `evt_in_${Date.now()}`,
      prospectId: prospect.id,
      type: ThreadEventType.CUSTOMER_INBOUND,
      direction: 'inbound',
      content: body,
      mediaUrls,
      timestamp: new Date(),
    };
    await this.store.addEvent(inboundEvent);

    await this.store.updateProspect(prospect.id, {
      status: ProspectStatus.WAITING_ON_US,
      journey: {
        ...prospect.journey,
        status: 'paused',
        pausedReason: 'Paused on customer inbound reply',
      },
    });

    await this.store.addEvent({
      id: `sys_${Date.now()}`,
      prospectId: prospect.id,
      type: ThreadEventType.SYSTEM,
      direction: 'internal',
      content: 'Automated journey paused due to inbound customer reply.',
      timestamp: new Date(),
    });

    return { event: inboundEvent, isOptOut: false };
  }

  async updateDeliveryStatus(
    messageId: string,
    status: DeliveryStatus,
    failureReason?: string,
  ) {
    return this.store.updateEventStatus(messageId, status, failureReason);
  }
}
