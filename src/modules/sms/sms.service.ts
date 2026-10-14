import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
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
import { randomUUID, createHash } from 'crypto';
import { WritebackService } from '../writeback/writeback.service';
import { compliantMessage } from '../../common/utils/message-template';
import { smsSegments } from '../../common/utils/sms-segments';

export interface SendSmsOptions {
  prospect: ProspectEntity;
  content: string;
  type: ThreadEventType.AUTOMATED_OUTBOUND | ThreadEventType.STAFF_OUTBOUND;
  authorName?: string;
  authorId?: string;
  journeyStepName?: string;
  leaseOwner?: string;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly twilioClient?: twilio.Twilio;

  constructor(
    private readonly store: StoreService,
    private readonly complianceService: ComplianceService,
    private readonly writebackService: WritebackService,
  ) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (accountSid && authToken && !accountSid.startsWith('ACxxx')) {
      try {
        this.twilioClient = twilio(accountSid, authToken, {
          timeout: 10000,
          autoRetry: false,
        });
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
    return smsSegments(text);
  }

  async sendOutboundSms(options: SendSmsOptions): Promise<ThreadEventEntity> {
    if (options.leaseOwner) return this.dispatchSms(options);
    const key = `prospect:${options.prospect.id}`;
    const owner = await this.store.lease(key, 120);
    if (!owner)
      throw new ConflictException(
        'Another conversation action is in progress; retry',
      );
    try {
      return await this.dispatchSms(options);
    } finally {
      await this.store.releaseLease(key, owner);
    }
  }

  private async dispatchSms(
    options: SendSmsOptions,
  ): Promise<ThreadEventEntity> {
    const { type, authorName, journeyStepName } = options;
    const latest = await this.store.findProspectById(options.prospect.id);
    if (!latest) throw new NotFoundException('Prospect not found');
    const prospect = {
      ...latest,
      journey: {
        ...latest.journey,
        ...(type === ThreadEventType.AUTOMATED_OUTBOUND
          ? options.prospect.journey
          : {}),
      },
    };
    if (
      prospect.status === ProspectStatus.OPTED_OUT ||
      prospect.consent?.enquiryConsent === false
    )
      throw new BadRequestException(
        'Opted-out or non-consenting prospects cannot receive SMS',
      );
    const settings = await this.store.getSettings();
    if (settings.requireExplicitConsent && !prospect.consent?.enquiryConsent)
      throw new BadRequestException('Recorded enquiry consent is required');
    await this.store.refreshRooftops();

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
    const content = compliantMessage(options.content, rooftop);
    // Pause before dispatch so a scheduler cannot speak over a staff send.
    if (type === ThreadEventType.STAFF_OUTBOUND)
      await this.store.updateProspect(prospect.id, {
        journey: {
          ...prospect.journey,
          status: 'paused',
          pausedReason: `Staff send by ${authorName || 'User'}`,
          nextScheduledStepAt: undefined,
        },
      });

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

    const eventId = `evt_${randomUUID()}`;
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
        authorId: options.authorId,
        journeyVersionId: prospect.journey.versionId,
        journeyVersion: prospect.journey.version,
      },
    };

    await this.store.addEvent(event);
    this.logger.log(
      `[SMS OUT] ${rooftop.name} -> ${prospect.normalizedMobile} (${type}): "${content}"`,
    );

    // Staff send → pause automated journey (Scope §7.2)
    if (type === ThreadEventType.STAFF_OUTBOUND) {
      const nowSuppressed = await this.store.isSuppressed(
        prospect.normalizedMobile,
      );
      await this.store.updateProspect(prospect.id, {
        status: nowSuppressed
          ? ProspectStatus.OPTED_OUT
          : initialStatus === DeliveryStatus.FAILED
            ? ProspectStatus.WAITING_ON_US
            : ProspectStatus.WAITING_ON_CUSTOMER,
        journey: {
          ...prospect.journey,
          status: nowSuppressed ? 'stopped' : 'paused',
          pausedReason: `Staff send by ${authorName || 'User'}`,
          nextScheduledStepAt: undefined,
        },
      });

      await this.store.addEvent({
        id: `sys_${randomUUID()}`,
        prospectId: prospect.id,
        type: ThreadEventType.SYSTEM,
        direction: 'internal',
        content: `Automated journey paused due to staff message sent by ${authorName || 'Staff'}.`,
        timestamp: new Date(),
      });
    }

    await this.writebackService.queueWriteback(
      prospect.id,
      prospect.dealerSocketOpportunityId,
      initialStatus === DeliveryStatus.FAILED
        ? 'sms_failed'
        : type === ThreadEventType.STAFF_OUTBOUND
          ? 'staff_sms_sent'
          : (prospect.journey.currentStep ?? 0) === 0
            ? 'journey_started'
            : 'automated_sms_sent',
      `${event.timestamp.toISOString()} | ${authorName || journeyStepName || 'Automation'} | ${content}`,
    );
    return event;
  }

  async processInboundSms(
    from: string,
    to: string,
    body: string,
    mediaUrls?: string[],
    messageId?: string,
  ) {
    const normFrom = PhoneNormalizer.normalizeAustralianPhone(from);
    if (!normFrom.isValid || !normFrom.normalized) {
      throw new BadRequestException(`Invalid Australian sender phone: ${from}`);
    }

    await this.store.refreshRooftops();
    const targetRooftop = this.store.getRooftopBySenderPhone(to);
    if (!targetRooftop)
      throw new BadRequestException('Unknown receiving rooftop number');
    const rooftopId = targetRooftop.id;
    const prospect = await this.store.latestProspectForMobile(
      normFrom.normalized,
      rooftopId,
    );
    const isOptOut = PhoneNormalizer.isOptOutKeyword(body);
    if (!prospect && isOptOut) {
      await this.complianceService.addSuppression(
        normFrom.normalized,
        'Unmatched customer STOP',
        'keyword_opt_out',
      );
      await this.store.audit('unmatched_opt_out', undefined, {
        mobile: normFrom.normalized,
        rooftopId,
      });
      await this.confirmOptOut(normFrom.normalized, targetRooftop);
      return { event: null, isOptOut: true };
    }

    if (!prospect) {
      throw new NotFoundException(
        `No open prospect found for mobile ${normFrom.normalized} at rooftop ${rooftopId}`,
      );
    }

    if (messageId && !(await this.store.claimCarrierMessage(messageId))) {
      const record = await this.store.recordGet('carrier_message', messageId);
      if (record?.data.state !== 'done')
        throw new ConflictException(
          'Carrier message is being processed; retry',
        );
      return { duplicate: true, event: null, isOptOut };
    }
    const key = `prospect:${prospect.id}`;
    const owner = await this.store.lease(key, 120);
    if (!owner) {
      if (messageId)
        await this.store.recordDelete('carrier_message', messageId);
      throw new ConflictException('Conversation is busy; carrier should retry');
    }
    try {
      const current = await this.store.findProspectById(prospect.id);
      if (current) prospect.journey = current.journey;

      if (isOptOut) {
        await this.complianceService.addSuppression(
          normFrom.normalized,
          `Opt-out keyword received: ${body.trim()}`,
          'keyword_opt_out',
        );

        const inboundEvent: ThreadEventEntity = {
          id: `evt_in_${messageId ? createHash('sha256').update(messageId).digest('hex') : randomUUID()}`,
          prospectId: prospect.id,
          type: ThreadEventType.CUSTOMER_INBOUND,
          direction: 'inbound',
          content: body,
          mediaUrls,
          timestamp: new Date(),
          metadata: { carrierMessageId: messageId },
        };
        await this.store.addEvent(inboundEvent);

        await this.store.addEvent({
          id: `sys_${randomUUID()}`,
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
            nextScheduledStepAt: undefined,
          },
        });

        await this.confirmOptOut(
          normFrom.normalized,
          targetRooftop,
          prospect.id,
        );
        if (messageId)
          await this.store.recordSave('carrier_message', messageId, {
            state: 'done',
          });

        return { event: inboundEvent, isOptOut: true };
      }

      // Normal inbound reply
      const inboundEvent: ThreadEventEntity = {
        id: `evt_in_${messageId ? createHash('sha256').update(messageId).digest('hex') : randomUUID()}`,
        prospectId: prospect.id,
        type: ThreadEventType.CUSTOMER_INBOUND,
        direction: 'inbound',
        content: body,
        mediaUrls,
        timestamp: new Date(),
        metadata: { carrierMessageId: messageId },
      };
      await this.store.addEvent(inboundEvent);

      const remainsSuppressed = await this.store.isSuppressed(
        normFrom.normalized,
      );
      await this.store.updateProspect(prospect.id, {
        status: remainsSuppressed
          ? ProspectStatus.OPTED_OUT
          : ProspectStatus.WAITING_ON_US,
        journey: {
          ...prospect.journey,
          status: remainsSuppressed ? 'stopped' : 'paused',
          pausedReason: 'Paused on customer inbound reply',
          nextScheduledStepAt: undefined,
        },
      });

      await this.store.addEvent({
        id: `sys_${randomUUID()}`,
        prospectId: prospect.id,
        type: ThreadEventType.SYSTEM,
        direction: 'internal',
        content: 'Automated journey paused due to inbound customer reply.',
        timestamp: new Date(),
      });

      await this.writebackService.queueWriteback(
        prospect.id,
        prospect.dealerSocketOpportunityId,
        'customer_replied',
        `${inboundEvent.timestamp.toISOString()} | Customer SMS: ${body}`,
      );
      await this.store.notifyOwner(
        prospect,
        'A customer reply is waiting for your response.',
      );
      if (messageId)
        await this.store.recordSave('carrier_message', messageId, {
          state: 'done',
        });
      return { event: inboundEvent, isOptOut: false };
    } catch (error) {
      if (messageId)
        await this.store.recordDelete('carrier_message', messageId);
      throw error;
    } finally {
      await this.store.releaseLease(key, owner);
    }
  }

  private async confirmOptOut(
    mobile: string,
    rooftop: import('../database/entities').RooftopEntity,
    prospectId?: string,
  ) {
    const key = `optout:${mobile}`;
    const owner = await this.store.lease(key, 120);
    if (!owner)
      throw new ConflictException('Opt-out confirmation is in progress; retry');
    try {
      if (await this.store.recordGet('optout_confirmation', mobile)) return;
      const content = `${rooftop.name}: You have successfully unsubscribed. No further commercial messages will be sent.`;
      let sid: string | undefined;
      let failure: string | undefined;
      try {
        if (this.twilioClient)
          sid = (
            await this.twilioClient.messages.create({
              body: content,
              from: rooftop.senderPhone,
              to: mobile,
              statusCallback:
                process.env.TWILIO_STATUS_CALLBACK_URL || undefined,
            })
          ).sid;
      } catch (error: any) {
        failure = error.message;
      }
      await this.store.recordSave('optout_confirmation', mobile, {
        timestamp: new Date(),
        failureReason: failure,
        simulated: !this.twilioClient,
      });
      if (prospectId)
        await this.store.addEvent({
          id: `evt_${randomUUID()}`,
          prospectId,
          type: ThreadEventType.AUTOMATED_OUTBOUND,
          direction: 'outbound',
          content,
          journeyStepName: 'Opt-out Confirmation',
          deliveryStatus: failure
            ? DeliveryStatus.FAILED
            : sid
              ? DeliveryStatus.PENDING
              : DeliveryStatus.DELIVERED,
          failureReason: failure,
          timestamp: new Date(),
          metadata: { twilioMessageSid: sid, simulated: !this.twilioClient },
        });
    } finally {
      await this.store.releaseLease(key, owner);
    }
  }

  async updateDeliveryStatus(
    messageId: string,
    status: DeliveryStatus,
    failureReason?: string,
  ) {
    return this.store.updateEventStatus(messageId, status, failureReason);
  }
}
