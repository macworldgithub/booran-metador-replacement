import type { JourneyStepDto } from '../operations/dto';
export const defaultJourneySteps: JourneyStepDto[] = [
  {
    name: 'Step 1: Ack',
    delayType: 'immediate',
    delayValue: 0,
    template:
      'Hi {{firstName}}, thanks for enquiring about {{vehicleDesc}} with {{rooftopName}}. Are you looking to purchase in the next few weeks, or just researching options? - {{salespersonName}}',
  },
  {
    name: 'Step 2: Qualify',
    delayType: 'business_hours',
    delayValue: 4,
    template:
      'Hi {{firstName}}, just following up from {{rooftopName}}. Did you have a specific colour or transmission in mind for {{vehicleDesc}}?',
  },
  {
    name: 'Step 3: Book',
    delayType: 'next_morning',
    delayValue: 0,
    template:
      'Good morning {{firstName}}, would you like to drop by {{rooftopName}} for a quick test drive of {{vehicleDesc}} this week?',
  },
  {
    name: 'Step 4: Nudge',
    delayType: 'calendar_days',
    delayValue: 2,
    template:
      'Hi {{firstName}}, checking in to see if you had any questions regarding {{vehicleDesc}} or trade-in valuations at {{rooftopName}}?',
  },
  {
    name: 'Step 5: Close Loop',
    delayType: 'calendar_days',
    delayValue: 6,
    template:
      'Hi {{firstName}}, we will close off this enquiry for now so we do not bother you. Feel free to call us if you wish to revisit {{vehicleDesc}}. All the best from {{rooftopName}}!',
  },
];
