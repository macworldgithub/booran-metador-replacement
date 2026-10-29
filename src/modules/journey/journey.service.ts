import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { StoreService } from '../database/store.service';
import { SmsService } from '../sms/sms.service';
import { ProspectEntity, RooftopEntity } from '../database/entities';
import {
  ThreadEventType,
  ProspectStatus,
  JourneyAction,
} from '../../common/enums';
import {
  businessHours,
  calendarDays,
  isOpen,
  nextMorning,
  nextOpen,
} from '../../common/utils/business-calendar';
import { renderMessage } from '../../common/utils/message-template';
import { defaultJourneySteps } from './default-journey';
import type { JourneyStepDto } from '../operations/dto';

@Injectable()
export class JourneyService {
  readonly defaultSteps = defaultJourneySteps.map((step, i) => ({
    ...step,
    step: i + 1,
    delayDesc: step.delayType,
  }));
  constructor(
    private readonly store: StoreService,
    private readonly smsService: SmsService,
  ) {}
  isWithinSendHours(rooftop: RooftopEntity) {
    return isOpen(rooftop);
  }
  renderTemplate(
    template: string,
    prospect: ProspectEntity,
    rooftop: RooftopEntity,
  ) {
    return renderMessage(template, prospect, rooftop);
  }
  async definition(prospect: ProspectEntity) {
    if (prospect.journey.versionId) {
      const version = await this.store.recordGet(
        'journey',
        prospect.journey.versionId,
      );
      if (!version)
        throw new BadRequestException('Journey version is unavailable');
      return { id: version.key, ...version.data };
    }
    const active = await this.store.recordGet(
      'journey_active',
      `${prospect.rooftopId}:${prospect.leadType ?? 'new_vehicle_internet'}`,
    );
    if (!active)
      return {
        id: undefined,
        version: 1,
        steps: defaultJourneySteps,
        enabled: true,
      };
    const version = await this.store.recordGet('journey', active.data.id);
    if (!version)
      throw new BadRequestException('Published journey is unavailable');
    return { id: version.key, ...version.data, enabled: active.data.enabled };
  }
  schedule(step: JourneyStepDto, prospect: ProspectEntity, at = new Date()) {
    const rooftop = this.store.getRooftopById(prospect.rooftopId)!;
    if (step.delayType === 'business_hours')
      return businessHours(rooftop, step.delayValue, at);
    if (step.delayType === 'next_morning') return nextMorning(rooftop, at);
    if (step.delayType === 'calendar_days') {
      const date = calendarDays(
        rooftop,
        step.delayValue,
        new Date(prospect.receivedAt ?? prospect.createdAt),
      );
      return date > at ? date : nextOpen(rooftop, at);
    }
    return nextOpen(rooftop, at);
  }
  async startJourneyForProspect(prospect: ProspectEntity): Promise<void> {
    await this.processDueProspect(prospect);
  }
  async processDueProspect(snapshot: ProspectEntity): Promise<boolean> {
    // One-way handset testing must not activate commercial SMS journeys.
    if (process.env.MOBILEMESSAGE_TEST_RECIPIENT) return false;
    const lock = `prospect:${snapshot.id}`;
    const owner = await this.store.lease(lock, 120);
    if (!owner) return false;
    try {
      await this.store.refreshRooftops();
      const prospect = await this.store.findProspectById(snapshot.id);
      if (
        !prospect ||
        prospect.journey.status !== 'active' ||
        [ProspectStatus.CLOSED, ProspectStatus.OPTED_OUT].includes(
          prospect.status,
        )
      )
        return false;
      if (
        prospect.journey.nextScheduledStepAt &&
        new Date(prospect.journey.nextScheduledStepAt) > new Date()
      )
        return false;
      const rooftop = this.store.getRooftopById(prospect.rooftopId);
      if (!rooftop) return false;
      const settings = await this.store.getSettings();
      const receivedAt = new Date(prospect.receivedAt ?? prospect.createdAt);
      if (
        (prospect.journey.currentStep ?? 0) === 0 &&
        (Date.now() - receivedAt.getTime() > 7 * 86400000 ||
          (settings.cutoverAt && receivedAt < new Date(settings.cutoverAt)))
      ) {
        await this.store.updateProspect(prospect.id, {
          journey: {
            ...prospect.journey,
            status: 'paused',
            pausedReason: 'Historical or pre-cutover lead requires review',
            nextScheduledStepAt: undefined,
          },
        });
        await this.store.createTask(
          prospect,
          'Review aged or pre-cutover lead; automatic enrolment was held',
          'cutover_review',
        );
        return false;
      }
      if (!isOpen(rooftop)) {
        await this.store.updateProspect(prospect.id, {
          journey: {
            ...prospect.journey,
            nextScheduledStepAt: nextOpen(rooftop),
          },
        });
        return false;
      }
      const definition = await this.definition(prospect);
      if (definition.enabled === false && !prospect.journey.versionId) {
        await this.store.updateProspect(prospect.id, {
          journey: {
            ...prospect.journey,
            status: 'paused',
            pausedReason: 'Journey enrolment disabled',
            nextScheduledStepAt: undefined,
          },
        });
        return false;
      }
      const step = definition.steps[prospect.journey.currentStep ?? 0] as
        JourneyStepDto | undefined;
      if (!step) return false;
      if (
        (await this.store.isSuppressed(prospect.normalizedMobile)) ||
        prospect.consent?.enquiryConsent === false ||
        (step.requiresMarketingConsent && !prospect.consent?.marketingConsent)
      ) {
        await this.store.updateProspect(prospect.id, {
          journey: {
            ...prospect.journey,
            status: 'stopped',
            pausedReason: 'Suppression or consent rule blocked sending',
            nextScheduledStepAt: undefined,
          },
        });
        return false;
      }
      prospect.journey = {
        ...prospect.journey,
        versionId: definition.id,
        version: definition.version,
        leadType: prospect.leadType ?? 'new_vehicle_internet',
        startedAt: prospect.journey.startedAt ?? new Date(),
      };
      const event = await this.smsService.sendOutboundSms({
        prospect,
        content: renderMessage(step.template, prospect, rooftop),
        type: ThreadEventType.AUTOMATED_OUTBOUND,
        journeyStepName: step.name,
        leaseOwner: owner,
      });
      if (await this.store.isSuppressed(prospect.normalizedMobile))
        return false;
      if (event.deliveryStatus === 'failed') {
        await this.store.updateProspect(prospect.id, {
          status: ProspectStatus.WAITING_ON_US,
          journey: {
            ...prospect.journey,
            status: 'paused',
            pausedReason: 'Automated SMS failed; staff review required',
            nextScheduledStepAt: undefined,
          },
        });
        return false;
      }
      const currentStep = (prospect.journey.currentStep ?? 0) + 1;
      const next = definition.steps[currentStep] as JourneyStepDto | undefined;
      await this.store.updateProspect(prospect.id, {
        status: next ? ProspectStatus.IN_JOURNEY : ProspectStatus.WAITING_ON_US,
        journey: {
          ...prospect.journey,
          status: next ? 'active' : 'completed',
          currentStep,
          currentStepName: step.name,
          lastStepSentAt: event.timestamp,
          nextScheduledStepAt: next ? this.schedule(next, prospect) : undefined,
        },
      });
      if (!next) {
        await this.store.createTask(
          prospect,
          'Close-loop journey completed: follow up with the customer',
          'close_loop',
        );
        await this.store.notifyOwner(
          prospect,
          'The automated journey has closed; a follow-up task is ready.',
        );
      }
      return true;
    } finally {
      await this.store.releaseLease(lock, owner);
    }
  }
  async manageJourney(
    id: string,
    action: JourneyAction,
    reason?: string,
  ): Promise<ProspectEntity> {
    const lock = `prospect:${id}`;
    const owner = await this.store.lease(lock, 120);
    if (!owner)
      throw new ConflictException(
        'A message or journey update is in progress; retry',
      );
    try {
      const prospect = await this.store.findProspectById(id);
      if (!prospect) throw new NotFoundException(`Prospect not found: ${id}`);
      if (
        action !== JourneyAction.STOP &&
        ([ProspectStatus.CLOSED, ProspectStatus.OPTED_OUT].includes(
          prospect.status,
        ) ||
          ['completed', 'stopped'].includes(prospect.journey.status) ||
          (await this.store.isSuppressed(prospect.normalizedMobile)))
      )
        throw new BadRequestException(
          'Closed, suppressed or ended journeys cannot restart',
        );
      const definition = await this.definition(prospect);
      let currentStep = prospect.journey.currentStep ?? 0;
      if (action === JourneyAction.SKIP_STEP) {
        if (currentStep >= definition.steps.length)
          throw new BadRequestException('No later step is available');
        currentStep++;
      }
      const status =
        action === JourneyAction.STOP
          ? 'stopped'
          : action === JourneyAction.RESUME
            ? 'active'
            : action === JourneyAction.PAUSE
              ? 'paused'
              : currentStep >= definition.steps.length
                ? 'completed'
                : prospect.journey.status;
      await this.store.addEvent({
        id: `sys_${randomUUID()}`,
        prospectId: id,
        type: ThreadEventType.SYSTEM,
        direction: 'internal',
        content: `Journey ${action}${reason ? ': ' + reason : ''}.`,
        timestamp: new Date(),
      });
      const updated = await this.store.updateProspect(id, {
        journey: {
          ...prospect.journey,
          currentStep,
          currentStepName:
            definition.steps[Math.max(0, currentStep - 1)]?.name ??
            'Pending Step 1',
          status,
          pausedReason: status === 'active' ? undefined : reason,
          nextScheduledStepAt:
            status === 'active'
              ? (prospect.journey.nextScheduledStepAt ??
                nextOpen(this.store.getRooftopById(prospect.rooftopId)!))
              : undefined,
        },
        ...(action === JourneyAction.STOP &&
        prospect.status !== ProspectStatus.OPTED_OUT
          ? { status: ProspectStatus.CLOSED }
          : action === JourneyAction.RESUME
            ? { status: ProspectStatus.IN_JOURNEY }
            : {}),
      });
      return updated!;
    } finally {
      await this.store.releaseLease(lock, owner);
    }
  }
  getTemplates() {
    return this.defaultSteps;
  }
}
