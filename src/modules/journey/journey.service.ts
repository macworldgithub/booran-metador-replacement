import { Injectable, Logger } from '@nestjs/common';
import { StoreService } from '../database/store.service';
import { SmsService } from '../sms/sms.service';
import {
  ProspectEntity,
  RooftopEntity,
} from '../database/entities';
import {
  ThreadEventType,
  ProspectStatus,
  JourneyAction,
} from '../../common/enums';

export interface JourneyStepDefinition {
  step: number;
  name: string;
  delayDesc: string;
  template: string;
}

@Injectable()
export class JourneyService {
  private readonly logger = new Logger(JourneyService.name);

  readonly defaultSteps: JourneyStepDefinition[] = [
    {
      step: 1,
      name: 'Step 1: Ack',
      delayDesc: 'Within 60s',
      template:
        'Hi {{firstName}}, thanks for enquiring about {{vehicleDesc}} with {{rooftopName}}. Are you looking to purchase in the next few weeks, or just researching options? - {{salespersonName}} (Reply STOP to opt out)',
    },
    {
      step: 2,
      name: 'Step 2: Qualify',
      delayDesc: '+4 business hours',
      template:
        'Hi {{firstName}}, just following up from {{rooftopName}}. Did you have a specific colour or transmission in mind for {{vehicleDesc}}? We have stock arriving shortly. (Reply STOP to opt out)',
    },
    {
      step: 3,
      name: 'Step 3: Book',
      delayDesc: 'Next business morning',
      template:
        'Good morning {{firstName}}, would you like to drop by {{rooftopName}} for a quick test drive of {{vehicleDesc}} this week? Let me know a time that suits you. (Reply STOP to opt out)',
    },
    {
      step: 4,
      name: 'Step 4: Nudge',
      delayDesc: 'Day 3',
      template:
        'Hi {{firstName}}, checking in to see if you had any questions regarding {{vehicleDesc}} or trade-in valuations at {{rooftopName}}? (Reply STOP to opt out)',
    },
    {
      step: 5,
      name: 'Step 5: Close Loop',
      delayDesc: 'Day 7',
      template:
        'Hi {{firstName}}, we will close off this enquiry for now so we do not bother you. Feel free to call us anytime at {{phone}} if you wish to revisit {{vehicleDesc}}. All the best from {{rooftopName}}!',
    },
  ];

  constructor(
    private readonly store: StoreService,
    private readonly smsService: SmsService,
  ) {}

  isWithinSendHours(rooftop: RooftopEntity): boolean {
    const now = new Date();
    const melbourneTimeStr = now.toLocaleTimeString('en-AU', {
      timeZone: 'Australia/Melbourne',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });
    const [currentHour, currentMin] = melbourneTimeStr.split(':').map(Number);
    const [startHour, startMin] = rooftop.sendHours.start.split(':').map(Number);
    const [endHour, endMin] = rooftop.sendHours.end.split(':').map(Number);
    const currentTotalMin = currentHour * 60 + currentMin;
    const startTotalMin = startHour * 60 + startMin;
    const endTotalMin = endHour * 60 + endMin;
    const dayName = now.toLocaleDateString('en-AU', {
      timeZone: 'Australia/Melbourne',
      weekday: 'long',
    });
    if (rooftop.closedDays.includes(dayName)) return false;
    return currentTotalMin >= startTotalMin && currentTotalMin < endTotalMin;
  }

  calculateNextStepSchedule(nextStepNumber: number): Date {
    const now = Date.now();
    switch (nextStepNumber) {
      case 2:
        // Step 2: +4 hours
        return new Date(now + 4 * 60 * 60 * 1000);
      case 3:
        // Step 3: +20 hours (next business morning)
        return new Date(now + 20 * 60 * 60 * 1000);
      case 4:
        // Step 4: Day 3 (+48 hours)
        return new Date(now + 48 * 60 * 60 * 1000);
      case 5:
        // Step 5: Day 7 (+96 hours from Step 4)
        return new Date(now + 96 * 60 * 60 * 1000);
      default:
        return new Date(now + 24 * 60 * 60 * 1000);
    }
  }

  renderTemplate(
    template: string,
    prospect: ProspectEntity,
    rooftop: RooftopEntity,
  ): string {
    const firstName = prospect.customer.firstName || 'there';
    const vehicleDesc =
      prospect.vehicle.make || prospect.vehicle.model
        ? `${prospect.vehicle.year ? prospect.vehicle.year + ' ' : ''}${prospect.vehicle.make || ''} ${prospect.vehicle.model || ''}`.trim()
        : 'the vehicle you enquired about';
    const salespersonName = prospect.assignedTo?.name || 'the team';
    return template
      .replace(/{{firstName}}/g, firstName)
      .replace(/{{vehicleDesc}}/g, vehicleDesc)
      .replace(/{{salespersonName}}/g, salespersonName)
      .replace(/{{rooftopName}}/g, rooftop.name)
      .replace(/{{phone}}/g, rooftop.displayPhone);
  }

  async startJourneyForProspect(prospect: ProspectEntity): Promise<void> {
    const rooftop = this.store.getRooftopById(prospect.rooftopId);
    if (!rooftop) return;

    const step1 = this.defaultSteps[0];
    const messageText = this.renderTemplate(step1.template, prospect, rooftop);

    // Update journey state before sending Step 1
    await this.store.updateProspect(prospect.id, {
      status: ProspectStatus.IN_JOURNEY,
      journey: {
        status: 'active',
        currentStep: 1,
        currentStepName: step1.name,
        lastStepSentAt: new Date(),
        nextScheduledStepAt: this.calculateNextStepSchedule(2),
      },
    });

    await this.smsService.sendOutboundSms({
      prospect,
      content: messageText,
      type: ThreadEventType.AUTOMATED_OUTBOUND,
      journeyStepName: step1.name,
    });
  }

  /**
   * Dispatches the next step for a prospect whose scheduled time is due.
   */
  async processDueProspect(prospect: ProspectEntity): Promise<boolean> {
    const rooftop = this.store.getRooftopById(prospect.rooftopId);
    if (!rooftop) return false;

    // Guard: ACMA send hours (9am - 8pm Melbourne time, not Sunday)
    if (!this.isWithinSendHours(rooftop)) {
      this.logger.debug(
        `Prospect ${prospect.id} is due for next journey step, but currently outside Rooftop ${rooftop.name} send hours. Deferring.`,
      );
      return false;
    }

    const currentStep = prospect.journey.currentStep || 1;
    const nextStepNum = currentStep + 1;

    if (nextStepNum > 5) {
      // Completed all 5 steps
      await this.store.updateProspect(prospect.id, {
        journey: {
          ...prospect.journey,
          status: 'completed',
          currentStep: 5,
          currentStepName: 'Completed (All steps sent)',
          nextScheduledStepAt: undefined,
        },
      });
      return true;
    }

    const stepDef = this.defaultSteps.find((s) => s.step === nextStepNum);
    if (!stepDef) return false;

    const messageText = this.renderTemplate(stepDef.template, prospect, rooftop);

    const isFinalStep = nextStepNum === 5;
    const nextSchedule = isFinalStep ? undefined : this.calculateNextStepSchedule(nextStepNum + 1);

    await this.store.updateProspect(prospect.id, {
      journey: {
        ...prospect.journey,
        status: isFinalStep ? 'completed' : 'active',
        currentStep: nextStepNum,
        currentStepName: stepDef.name,
        lastStepSentAt: new Date(),
        nextScheduledStepAt: nextSchedule,
      },
    });

    await this.smsService.sendOutboundSms({
      prospect,
      content: messageText,
      type: ThreadEventType.AUTOMATED_OUTBOUND,
      journeyStepName: stepDef.name,
    });

    this.logger.log(
      `Dispatched Journey Step ${nextStepNum} to ${prospect.normalizedMobile} (Opp #${prospect.dealerSocketOpportunityId})`,
    );

    return true;
  }

  async manageJourney(
    prospectId: string,
    action: JourneyAction,
    reason?: string,
  ): Promise<ProspectEntity> {
    const prospect = await this.store.findProspectById(prospectId);
    if (!prospect) throw new Error(`Prospect not found: ${prospectId}`);

    const currentJourney = prospect.journey;
    let newStatus = currentJourney.status;
    let currentStep = currentJourney.currentStep;
    let currentStepName = currentJourney.currentStepName;

    switch (action) {
      case JourneyAction.PAUSE:
        newStatus = 'paused';
        await this.store.addEvent({
          id: `sys_${Date.now()}`,
          prospectId,
          type: ThreadEventType.SYSTEM,
          direction: 'internal',
          content: `Journey manually paused: ${reason || 'Staff requested pause'}`,
          timestamp: new Date(),
        });
        break;

      case JourneyAction.RESUME:
        newStatus = 'active';
        await this.store.addEvent({
          id: `sys_${Date.now()}`,
          prospectId,
          type: ThreadEventType.SYSTEM,
          direction: 'internal',
          content: 'Journey manually resumed by staff.',
          timestamp: new Date(),
        });
        break;

      case JourneyAction.SKIP_STEP:
        currentStep = Math.min(5, currentStep + 1);
        currentStepName = this.defaultSteps[currentStep - 1]?.name || 'Completed';
        await this.store.addEvent({
          id: `sys_${Date.now()}`,
          prospectId,
          type: ThreadEventType.SYSTEM,
          direction: 'internal',
          content: `Journey skipped to ${currentStepName}.`,
          timestamp: new Date(),
        });
        break;

      case JourneyAction.STOP:
        newStatus = 'stopped';
        await this.store.addEvent({
          id: `sys_${Date.now()}`,
          prospectId,
          type: ThreadEventType.SYSTEM,
          direction: 'internal',
          content: `Journey ended: ${reason || 'Staff stopped journey'}`,
          timestamp: new Date(),
        });
        break;
    }

    const updated = await this.store.updateProspect(prospectId, {
      journey: {
        ...currentJourney,
        status: newStatus,
        currentStep,
        currentStepName,
        pausedReason: reason,
      },
    });

    return updated!;
  }

  getTemplates(): JourneyStepDefinition[] {
    return this.defaultSteps;
  }
}
