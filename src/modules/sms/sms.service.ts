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

import { Cron } from '@nestjs/schedule';
import {
  MobileMessageService,
  MobileMessageError,
} from './mobile-message.service';
import { randomUUID, createHash } from 'crypto';
import { WritebackService } from '../writeback/writeback.service';
import { compliantMessage } from '../../common/utils/message-template';
import { smsSegments } from '../../common/utils/sms-segments';
import { isOpen } from '../../common/utils/business-calendar';

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
  constructor(
    private readonly store: StoreService,
    private readonly complianceService: ComplianceService,
    private readonly writebackService: WritebackService,
    private readonly provider: MobileMessageService,
  ) {}

  calculateSegments(text: string) {
    return smsSegments(text);
  }

  async gatewayStatus() {
    const inbox = await this.store.recordList('sms_inbox', {
      'data.state': { $ne: 'done' },
    });
    const outbox = await this.store.recordList('sms_outbox', {
      'data.state': { $ne: 'accepted' },
    });
    return {
      provider: 'mobilemessage',
      enabled: process.env.MOBILEMESSAGE_ENABLED === 'true',
      credentialsConfigured: !!(
        process.env.MOBILEMESSAGE_API_USERNAME &&
        process.env.MOBILEMESSAGE_API_PASSWORD
      ),
      signatureConfigured: !!process.env.MOBILEMESSAGE_WEBHOOK_SECRET,
      inbox: inbox.map((record) => ({
        id: record.key,
        state: record.data.state,
        attempts: record.data.attempts,
        error: record.data.error,
      })),
      outbox: outbox.map((record) => ({
        eventId: record.key,
        state: record.data.state,
        attempts: record.data.attempts,
      })),
    };
  }

  private async deliverJob(id: string) {
    const owner = await this.store.lease(`sms-send:${id}`, 90);
    if (!owner) return;
    try {
      const record = await this.store.recordGet('sms_outbox', id);
      if (!record || record.data.state !== 'pending') return;
      const job = record.data;
      if (job.nextAttemptAt && job.nextAttemptAt > Date.now()) return;
      if (Date.now() - job.createdAt > 23 * 3600_000) {
        job.state = 'review';
        await this.store.recordSave('sms_outbox', id, job);
        await this.store.patchSmsEvent(id, {
          failureReason:
            'Acceptance uncertain; manual reconciliation required. Do not resend.',
        });
        return;
      }
      const prospect = await this.store.findProspectById(job.prospectId);
      // An interrupted request may already have reached the carrier. Do not retry
      // after consent changes; retain it for reconciliation instead.
      const settings = await this.store.getSettings();
      const event =
        (await this.store.smsEvent(id)) ??
        (job.event ? await this.store.addEvent(job.event) : null);
      if (!event) throw new NotFoundException('Outgoing SMS event is missing');
      if (event?.metadata?.providerMessageId) {
        await this.store.recordSave('sms_outbox', id, {
          ...job,
          state: 'accepted',
        });
        return;
      }
      const automated = event?.type === ThreadEventType.AUTOMATED_OUTBOUND;
      if (automated && process.env.MOBILEMESSAGE_TEST_RECIPIENT) return;
      const rooftop = prospect && this.store.getRooftopById(prospect.rooftopId);
      if (
        !prospect ||
        prospect.consent?.enquiryConsent === false ||
        (settings.requireExplicitConsent &&
          !prospect.consent?.enquiryConsent) ||
        (automated &&
          ['paused', 'stopped'].includes(prospect.journey.status)) ||
        (await this.store.isSuppressed(prospect.normalizedMobile))
      ) {
        job.state = job.attempts ? 'review' : 'failed';
        await this.store.recordSave('sms_outbox', id, job);
        await this.store.patchSmsEvent(id, {
          deliveryStatus: job.attempts
            ? DeliveryStatus.PENDING
            : DeliveryStatus.FAILED,
          failureReason:
            'Sending stopped by consent/suppression; reconcile any previous attempt',
        });
        return;
      }
      if (automated && (!rooftop || !isOpen(rooftop))) return;
      job.attempts++;
      job.nextAttemptAt =
        Date.now() +
        Math.min(3600_000, 30_000 * 2 ** Math.min(job.attempts, 7));
      await this.store.recordSave('sms_outbox', id, job);
      let providerId: string;
      try {
        providerId = await this.provider.send(job.payload, job.key);
      } catch (error) {
        const retryable =
          error instanceof MobileMessageError && error.retryable;
        job.state = retryable ? 'pending' : 'failed';
        await this.store.patchSmsEvent(id, {
          ...(retryable ? {} : { deliveryStatus: DeliveryStatus.FAILED }),
          failureReason:
            error instanceof MobileMessageError
              ? error.message
              : 'SMS provider error',
        });
        await this.store.recordSave('sms_outbox', id, job);
        if (!retryable && job.attempts > 1) {
          await this.store.createTask(
            prospect,
            'SMS send failed; review the conversation before retrying',
            id,
          );
          if (automated && prospect.journey.status === 'active')
            await this.store.updateProspect(prospect.id, {
              status: ProspectStatus.WAITING_ON_US,
              journey: {
                ...prospect.journey,
                status: 'paused',
                pausedReason: 'SMS provider failure',
                nextScheduledStepAt: undefined,
              },
            });
        }
        return;
      }
      // Database errors after acceptance must leave the same retry key intact.
      await this.store.patchSmsEvent(id, {
        'metadata.providerMessageId': providerId,
        'metadata.providerAcceptedAt': new Date().toISOString(),
      });
      job.state = 'accepted';
      await this.store.recordSave('sms_outbox', id, job);
    } finally {
      await this.store.releaseLease(`sms-send:${id}`, owner);
    }
  }

  async enqueueWebhook(kind: 'inbound' | 'delivery', payload: any) {
    const strings =
      kind === 'inbound'
        ? ['sender', 'to', 'message', 'received_at', 'type']
        : ['message_id', 'status', 'received_at', 'to', 'sender'];
    if (
      !payload ||
      strings.some(
        (key) => typeof payload[key] !== 'string' || !payload[key].trim(),
      )
    )
      throw new BadRequestException('Invalid Mobile Message webhook fields');
    for (const key of [
      'custom_ref',
      'original_custom_ref',
      'original_message_id',
    ]) {
      if (
        payload[key] != null &&
        (typeof payload[key] !== 'string' || payload[key].length > 255)
      )
        throw new BadRequestException('Invalid Mobile Message reference');
    }
    if (
      kind === 'inbound' &&
      !['inbound', 'unsubscribe'].includes(payload.type)
    )
      throw new BadRequestException('Unknown inbound type');
    if (
      kind === 'delivery' &&
      (!['sent', 'delivered', 'failed'].includes(payload.status) ||
        !Number.isInteger(payload.part_number) ||
        !Number.isInteger(payload.total_parts) ||
        payload.part_number < 1 ||
        payload.total_parts < payload.part_number ||
        payload.total_parts > 100)
    )
      throw new BadRequestException('Invalid delivery status or part numbers');
    const date = new Date(
      payload.received_at.replace(' ', 'T') +
        (/Z$|[+-]\d\d:\d\d$/.test(payload.received_at) ? '' : 'Z'),
    );
    if (!Number.isFinite(date.getTime()))
      throw new BadRequestException('Invalid received_at');
    const canonical = Object.fromEntries(
      Object.keys(payload)
        .sort()
        .map((key) => [key, payload[key]]),
    );
    const id = createHash('sha256')
      .update(kind + JSON.stringify(canonical))
      .digest('hex');
    await this.store.recordInsert('sms_inbox', id, {
      kind,
      payload,
      receivedAt: date.toISOString(),
      state: 'pending',
      attempts: 0,
    });
    return { accepted: true };
  }

  @Cron('*/5 * * * * *')
  async processSmsQueues() {
    for (const record of await this.store.recordList('sms_inbox', {
      'data.state': 'pending',
    })) {
      const owner = await this.store.lease(`sms-inbox:${record.key}`, 120);
      if (!owner) continue;
      try {
        const fresh = await this.store.recordGet('sms_inbox', record.key);
        if (fresh?.data.state !== 'pending') continue;
        const data = fresh.data;
        if (data.nextAttemptAt > Date.now()) continue;
        try {
          const p = data.payload;
          if (data.kind === 'inbound') {
            // Suppress globally even when sender routing cannot yet be resolved.
            if (
              !data.suppressionApplied &&
              (p.type === 'unsubscribe' ||
                PhoneNormalizer.isOptOutKeyword(p.message))
            ) {
              await this.complianceService.addSuppression(
                p.sender,
                'Mobile Message unsubscribe',
                'keyword_opt_out',
              );
              data.suppressionApplied = true;
              await this.store.recordSave('sms_inbox', record.key, data);
            }
            await this.processInboundSms(
              p.sender,
              p.to,
              p.message,
              undefined,
              record.key,
              p.original_custom_ref || p.original_message_id,
              new Date(data.receivedAt),
              p.type === 'unsubscribe',
              true,
              !!data.suppressionApplied,
            );
          } else await this.processReceipt(p, data.receivedAt);
          data.state = 'done';
        } catch {
          data.attempts++;
          data.nextAttemptAt =
            Date.now() + Math.min(3600_000, data.attempts * 30_000);
          if (data.attempts >= 20) data.state = 'review';
          data.error =
            'Webhook could not be applied; inspect routing and associated event';
        }
        await this.store.recordSave('sms_inbox', record.key, data);
      } finally {
        await this.store.releaseLease(`sms-inbox:${record.key}`, owner);
      }
    }
    for (const job of await this.store.recordList('sms_outbox', {
      'data.state': 'pending',
    })) {
      const key = `prospect:${job.data.prospectId}`;
      const owner = await this.store.lease(key, 120);
      if (!owner) continue;
      try {
        await this.deliverJob(job.key);
      } finally {
        await this.store.releaseLease(key, owner);
      }
    }
  }

  private async processReceipt(p: any, receivedAt: string) {
    const event = await this.store.smsEvent(p.custom_ref || p.message_id);
    if (!event) throw new NotFoundException('Message not yet found');
    const normal = (phone: string) =>
      PhoneNormalizer.normalizeAustralianPhone(phone).normalized;
    if (
      !normal(p.to) ||
      normal(event.metadata?.to) !== normal(p.to) ||
      normal(event.metadata?.from) !== normal(p.sender) ||
      (event.metadata?.providerMessageId &&
        event.metadata.providerMessageId !== p.message_id)
    )
      throw new BadRequestException('Receipt does not match message');
    const owner = await this.store.lease(`sms-receipt:${event.id}`, 60);
    if (!owner) throw new ConflictException('Receipt busy');
    try {
      const current = (await this.store.smsEvent(event.id))!;
      const parts = current.metadata?.deliveryParts ?? {};
      const previous = parts[p.part_number];
      if (
        !previous ||
        (previous.status === 'sent' &&
          new Date(receivedAt) >= new Date(previous.receivedAt))
      )
        parts[p.part_number] = { status: p.status, receivedAt };
      const total = Math.max(current.metadata?.totalParts ?? 0, p.total_parts);
      const entries: any[] = Object.values(parts);
      const status = entries.some((part) => part.status === 'failed')
        ? DeliveryStatus.FAILED
        : Array.from(
              { length: total },
              (_, i) => parts[i + 1]?.status === 'delivered',
            ).every(Boolean)
          ? DeliveryStatus.DELIVERED
          : DeliveryStatus.PENDING;
      await this.store.patchSmsEvent(event.id, {
        'metadata.deliveryParts': parts,
        'metadata.totalParts': total,
        'metadata.providerMessageId': p.message_id,
        deliveryStatus: status,
        failureReason:
          status === DeliveryStatus.FAILED ? 'Carrier delivery failed' : null,
      });
    } finally {
      await this.store.releaseLease(`sms-receipt:${event.id}`, owner);
    }
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
    if (
      type === ThreadEventType.AUTOMATED_OUTBOUND &&
      process.env.MOBILEMESSAGE_TEST_RECIPIENT
    )
      throw new BadRequestException(
        'Automated SMS is paused during one-way handset testing',
      );
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

    let rooftop = this.store.getRooftopById(prospect.rooftopId);
    if (!rooftop)
      throw new NotFoundException(`Rooftop not found: ${prospect.rooftopId}`);
    if (process.env.MOBILEMESSAGE_TEST_RECIPIENT) {
      const allowed = PhoneNormalizer.normalizeAustralianPhone(
        process.env.MOBILEMESSAGE_TEST_RECIPIENT,
      ).normalized;
      if (!allowed || prospect.normalizedMobile !== allowed)
        throw new BadRequestException(
          'SMS test mode only allows the configured test recipient',
        );
      if (
        prospect.rooftopId !== RooftopId.CRANBOURNE_KIA ||
        !process.env.SMS_KIA_NUMBER
      )
        throw new BadRequestException(
          'This one-number SMS test is configured for Cranbourne Kia only',
        );
      // Use the explicitly configured test sender, rather than a historical saved number.
      rooftop = { ...rooftop, senderPhone: process.env.SMS_KIA_NUMBER };
    }
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

    let initialStatus = DeliveryStatus.PENDING;
    let failureReason: string | undefined;

    const eventId =
      type === ThreadEventType.AUTOMATED_OUTBOUND
        ? `evt_auto_${createHash('sha256')
            .update(
              JSON.stringify([
                prospect.id,
                prospect.journey.startedAt,
                prospect.journey.versionId,
                prospect.journey.currentStep,
              ]),
            )
            .digest('hex')}`
        : `evt_${randomUUID()}`;
    const previous = await this.store.smsEvent(eventId);
    const outstanding = await this.store.recordList('sms_outbox', {
      'data.prospectId': prospect.id,
      'data.state': { $in: ['pending', 'review'] },
    });
    if (outstanding.some((record) => record.key !== eventId))
      throw new ConflictException(
        'A previous SMS is awaiting provider acceptance or manual reconciliation',
      );
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
        provider: 'mobilemessage',
        customRef: eventId,
        authorId: options.authorId,
        journeyVersionId: prospect.journey.versionId,
        journeyVersion: prospect.journey.version,
      },
    };

    const existingJob = await this.store.recordGet('sms_outbox', eventId);
    const persisted = previous ?? existingJob?.data.event ?? event;
    const job = {
      eventId,
      prospectId: prospect.id,
      createdAt: Date.now(),
      attempts: 0,
      state: 'pending',
      event: persisted,
      key: eventId,
      payload: {
        messages: [
          {
            to: persisted.metadata?.to,
            sender: persisted.metadata?.from,
            message: persisted.content,
            custom_ref: eventId,
          },
        ],
        enable_unicode: true,
      },
    };
    await this.store.recordInsert('sms_outbox', eventId, job);
    await this.store.addEvent(persisted);
    await this.deliverJob(eventId);
    const savedEvent = await this.store.smsEvent(eventId);
    initialStatus = savedEvent?.deliveryStatus ?? DeliveryStatus.PENDING;
    failureReason = savedEvent?.failureReason;
    event.deliveryStatus = initialStatus;
    event.failureReason = failureReason;
    event.metadata = savedEvent?.metadata ?? event.metadata;
    if (previous || existingJob) return savedEvent ?? persisted;

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

    // Handset test conversations must not queue activity against a real CRM.
    if (!process.env.MOBILEMESSAGE_TEST_RECIPIENT)
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
    correlation?: string,
    receivedAt?: Date,
    forceOptOut = false,
    resumeProcessing = false,
    suppressionAlreadyApplied = false,
  ) {
    const normFrom = PhoneNormalizer.normalizeAustralianPhone(from);
    if (!normFrom.isValid || !normFrom.normalized) {
      throw new BadRequestException(`Invalid Australian sender phone: ${from}`);
    }

    await this.store.refreshRooftops();
    const targetRooftop = this.store.getRooftopBySenderPhone(
      PhoneNormalizer.normalizeAustralianPhone(to).normalized || to,
    );
    if (!targetRooftop)
      throw new BadRequestException('Unknown receiving rooftop number');
    const rooftopId = targetRooftop.id;
    const outbound = correlation
      ? await this.store.smsEvent(correlation)
      : null;
    const correlated = outbound
      ? await this.store.findProspectById(outbound.prospectId)
      : null;
    const prospect =
      correlated?.normalizedMobile === normFrom.normalized &&
      correlated.rooftopId === rooftopId
        ? correlated
        : await this.store.unambiguousProspect(normFrom.normalized, rooftopId);
    const isOptOut = forceOptOut || PhoneNormalizer.isOptOutKeyword(body);
    if (!prospect && isOptOut) {
      if (!suppressionAlreadyApplied)
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
      if (record?.data.state === 'done')
        return { duplicate: true, event: null, isOptOut };
      if (!resumeProcessing)
        throw new ConflictException(
          'Carrier message is being processed; retry',
        );
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
        if (!suppressionAlreadyApplied)
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
          timestamp: receivedAt ?? new Date(),
          metadata: { carrierMessageId: messageId },
        };
        await this.store.addEvent(inboundEvent);

        await this.store.addEvent({
          id: messageId ? `sys_stop_${inboundEvent.id}` : `sys_${randomUUID()}`,
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
        timestamp: receivedAt ?? new Date(),
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
        id: messageId ? `sys_reply_${inboundEvent.id}` : `sys_${randomUUID()}`,
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
        inboundEvent.id,
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
      // Configure a single provider unsubscribe confirmation rule. Never bypass provider suppression
      // to send a second commercial/confirmation SMS after a STOP.
      await this.store.recordSave('optout_confirmation', mobile, {
        timestamp: new Date(),
        handling: 'provider_rule_required',
        confirmationDelivery: 'not_verified',
        prospectId,
        rooftopId: rooftop.id,
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
