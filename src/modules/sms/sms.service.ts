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

  constructor(
    private readonly store: StoreService,
    private readonly complianceService: ComplianceService,
  ) {}

  /**
   * Calculates GSM character count and segment count for the composer UI.
   */
  calculateSegments(text: string) {
    const isUnicode = /[^\u0000-\u007F]/.test(text);
    const charCount = text.length;

    let segmentLimit = 160;
    let multiLimit = 153;

    if (isUnicode) {
      segmentLimit = 70;
      multiLimit = 67;
    }

    const segments =
      charCount === 0
        ? 1
        : charCount <= segmentLimit
          ? 1
          : Math.ceil(charCount / multiLimit);

    return {
      charCount,
      segments,
      isUnicode,
      maxSingleSegment: segmentLimit,
    };
  }

  /**
   * Sends an SMS message to a customer prospect, ensuring Spam Act compliance.
   */
  async sendOutboundSms(options: SendSmsOptions): Promise<ThreadEventEntity> {
    const { prospect, content, type, authorName, journeyStepName } = options;

    // Check suppression list across all 3 rooftops
    if (this.complianceService.isMobileSuppressed(prospect.normalizedMobile)) {
      this.logger.warn(
        `Blocked send to suppressed mobile ${prospect.normalizedMobile}`,
      );
      throw new BadRequestException(
        `Mobile ${prospect.normalizedMobile} is in the 3-rooftop suppression list`,
      );
    }

    const rooftop = this.store.getRooftopById(prospect.rooftopId);
    if (!rooftop) {
      throw new NotFoundException(`Rooftop not found: ${prospect.rooftopId}`);
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
      deliveryStatus: DeliveryStatus.DELIVERED, // Simulated carrier delivery
      timestamp: new Date(),
      metadata: {
        from: rooftop.senderPhone,
        to: prospect.normalizedMobile,
        rooftopName: rooftop.name,
      },
    };

    this.store.addEvent(event);
    this.logger.log(
      `[SMS OUT] ${rooftop.name} -> ${prospect.normalizedMobile} (${type}): "${content}"`,
    );

    // If staff sent from portal, pause automated journey per Scope 7.2
    if (type === ThreadEventType.STAFF_OUTBOUND) {
      this.store.updateProspect(prospect.id, {
        status: ProspectStatus.WAITING_ON_CUSTOMER,
        journey: {
          ...prospect.journey,
          status: 'paused',
          pausedReason: `Staff send by ${authorName || 'User'}`,
        },
      });

      // Also log system event on thread
      this.store.addEvent({
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

  /**
   * Processes an incoming SMS from a customer carrier webhook.
   * Matches lead, checks opt-out keywords (STOP), and updates the chronological thread.
   */
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

    // Identify rooftop from the destination number
    const targetRooftop = this.store.getRooftopBySenderPhone(to);
    const rooftopId = targetRooftop ? targetRooftop.id : RooftopId.CRANBOURNE_KIA;

    // Find the prospect thread
    let prospect = this.store.findRecentProspectByMobileAndRooftop(
      normFrom.normalized,
      rooftopId,
      30,
    );

    if (!prospect) {
      // Find by mobile across rooftops if not found in 30 days
      const allProspects = this.store.queryProspects({ search: normFrom.normalized });
      prospect = allProspects[0];
    }

    if (!prospect) {
      throw new NotFoundException(
        `No open prospect found for mobile ${normFrom.normalized} at rooftop ${rooftopId}`,
      );
    }

    const isOptOut = PhoneNormalizer.isOptOutKeyword(body);

    if (isOptOut) {
      // Action Spam Act opt-out across ALL 3 rooftops
      this.complianceService.addSuppression(
        normFrom.normalized,
        `Opt-out keyword received: ${body.trim()}`,
        'keyword_opt_out',
      );

      // 1. Add inbound event
      const inboundEvent: ThreadEventEntity = {
        id: `evt_in_${Date.now()}`,
        prospectId: prospect.id,
        type: ThreadEventType.CUSTOMER_INBOUND,
        direction: 'inbound',
        content: body,
        mediaUrls,
        timestamp: new Date(),
      };
      this.store.addEvent(inboundEvent);

      // 2. Add system event
      this.store.addEvent({
        id: `sys_${Date.now()}`,
        prospectId: prospect.id,
        type: ThreadEventType.SYSTEM,
        direction: 'internal',
        content: `Customer unsubscribed (${body.trim()}). Number added to 3-rooftop global suppression list.`,
        timestamp: new Date(),
      });

      // 3. Update prospect status
      this.store.updateProspect(prospect.id, {
        status: ProspectStatus.OPTED_OUT,
        journey: {
          ...prospect.journey,
          status: 'stopped',
          pausedReason: 'Customer opted out with STOP keyword',
        },
      });

      // 4. Send single confirmation SMS as required by Scope 7.2 & 11
      const rooftop = this.store.getRooftopById(prospect.rooftopId);
      const rooftopName = rooftop ? rooftop.name : 'Dealership';
      const confirmEvent: ThreadEventEntity = {
        id: `evt_optout_conf_${Date.now()}`,
        prospectId: prospect.id,
        type: ThreadEventType.AUTOMATED_OUTBOUND,
        direction: 'outbound',
        content: `${rooftopName}: You have successfully unsubscribed. No further messages will be sent.`,
        journeyStepName: 'Opt-out Confirmation',
        deliveryStatus: DeliveryStatus.DELIVERED,
        timestamp: new Date(),
      };
      this.store.addEvent(confirmEvent);

      return { event: inboundEvent, isOptOut: true };
    }

    // Normal customer reply:
    // Append customer inbound event to chronological thread
    const inboundEvent: ThreadEventEntity = {
      id: `evt_in_${Date.now()}`,
      prospectId: prospect.id,
      type: ThreadEventType.CUSTOMER_INBOUND,
      direction: 'inbound',
      content: body,
      mediaUrls,
      timestamp: new Date(),
    };
    this.store.addEvent(inboundEvent);

    // Pause automated journey per Scope 7.2:
    // "A customer reply pauses the automated sequence and raises the thread in the portal."
    this.store.updateProspect(prospect.id, {
      status: ProspectStatus.WAITING_ON_US,
      journey: {
        ...prospect.journey,
        status: 'paused',
        pausedReason: 'Paused on customer inbound reply',
      },
    });

    this.store.addEvent({
      id: `sys_${Date.now()}`,
      prospectId: prospect.id,
      type: ThreadEventType.SYSTEM,
      direction: 'internal',
      content: 'Automated journey paused due to inbound customer reply.',
      timestamp: new Date(),
    });

    return { event: inboundEvent, isOptOut: false };
  }

  updateDeliveryStatus(
    messageId: string,
    status: DeliveryStatus,
    failureReason?: string,
  ) {
    return this.store.updateEventStatus(messageId, status, failureReason);
  }
}
