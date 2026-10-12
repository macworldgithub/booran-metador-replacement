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

  // Default 5-Step Journey per Scope Section 7.1
  private readonly defaultSteps: JourneyStepDefinition[] = [
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

  /**
   * Checks if current time is within send hours (9:00 - 20:00 AEST/AEDT)
   * and not on a closed day.
   */
  isWithinSendHours(rooftop: RooftopEntity): boolean {
    const now = new Date();
    // Default Melbourne time offset UTC+10 (AEST) / UTC+11 (AEDT)
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

    if (rooftop.closedDays.includes(dayName)) {
      return false;
    }

    return currentTotalMin >= startTotalMin && currentTotalMin < endTotalMin;
  }

  /**
   * Renders journey template with merge fields and fallbacks.
   * Ensures missing vehicle fields fallback gracefully, never displaying blank tokens.
   */
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
    const rooftopName = rooftop.name;
    const phone = rooftop.displayPhone;

    return template
      .replace(/{{firstName}}/g, firstName)
      .replace(/{{vehicleDesc}}/g, vehicleDesc)
      .replace(/{{salespersonName}}/g, salespersonName)
      .replace(/{{rooftopName}}/g, rooftopName)
      .replace(/{{phone}}/g, phone);
  }

  /**
   * Starts Step 1 immediately upon qualifying lead drop.
   */
  async startJourneyForProspect(prospect: ProspectEntity): Promise<void> {
    const rooftop = this.store.getRooftopById(prospect.rooftopId);
    if (!rooftop) return;

    const step1 = this.defaultSteps[0];
    const messageText = this.renderTemplate(step1.template, prospect, rooftop);

    // Update journey state
    this.store.updateProspect(prospect.id, {
      status: ProspectStatus.IN_JOURNEY,
      journey: {
        status: 'active',
        currentStep: 1,
        currentStepName: step1.name,
        lastStepSentAt: new Date(),
        nextScheduledStepAt: new Date(Date.now() + 4 * 60 * 60 * 1000), // +4 hrs for Step 2
      },
    });

    // Send Step 1 Outbound SMS
    await this.smsService.sendOutboundSms({
      prospect,
      content: messageText,
      type: ThreadEventType.AUTOMATED_OUTBOUND,
      journeyStepName: step1.name,
    });
  }

  /**
   * Manually controls journey state (pause, resume, skip, stop).
   */
  manageJourney(
    prospectId: string,
    action: JourneyAction,
    reason?: string,
  ): ProspectEntity {
    const prospect = this.store.findProspectById(prospectId);
    if (!prospect) {
      throw new Error(`Prospect not found: ${prospectId}`);
    }

    const currentJourney = prospect.journey;
    let newStatus = currentJourney.status;
    let currentStep = currentJourney.currentStep;
    let currentStepName = currentJourney.currentStepName;

    switch (action) {
      case JourneyAction.PAUSE:
        newStatus = 'paused';
        this.store.addEvent({
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
        this.store.addEvent({
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
        this.store.addEvent({
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
        this.store.addEvent({
          id: `sys_${Date.now()}`,
          prospectId,
          type: ThreadEventType.SYSTEM,
          direction: 'internal',
          content: `Journey ended: ${reason || 'Staff stopped journey'}`,
          timestamp: new Date(),
        });
        break;
    }

    const updated = this.store.updateProspect(prospectId, {
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
