import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { nextOpen } from '../../common/utils/business-calendar';
import { StoreService } from '../database/store.service';
import { ComplianceService } from '../compliance/compliance.service';
import { JourneyService } from '../journey/journey.service';
import { WritebackService } from '../writeback/writeback.service';
import { PhoneNormalizer } from '../../common/utils/phone-normalizer.util';
import { IngestLeadDto } from './dto/ingest-lead.dto';
import { ProspectStatus, ThreadEventType } from '../../common/enums';
import { ProspectEntity } from '../database/entities';

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly store: StoreService,
    private readonly complianceService: ComplianceService,
    private readonly journeyService: JourneyService,
    private readonly writebackService: WritebackService,
  ) {}

  async ingestLead(dto: IngestLeadDto) {
    if (dto.isNewLead === false)
      throw new BadRequestException('Historical lead replays are not in scope');
    const keys = [
      `intake:opp:${dto.dealerSocketOpportunityId}`,
      `intake:mobile:${dto.rooftopId}:${PhoneNormalizer.normalizeAustralianPhone(dto.customer.mobile).normalized ?? dto.customer.mobile}`,
    ];
    const owners: string[] = [];
    try {
      for (const key of keys) {
        const owner = await this.store.lease(key, 120);
        if (!owner)
          throw new ConflictException('This lead is being ingested; retry');
        owners.push(owner);
      }
      return await this.ingestLocked(dto);
    } finally {
      for (let i = 0; i < owners.length; i++)
        await this.store.releaseLease(keys[i], owners[i]);
    }
  }

  private async ingestLocked(dto: IngestLeadDto) {
    await this.store.refreshRooftops();
    const settings = await this.store.getSettings();
    const existing = await this.store.findProspectByOpportunityId(
      dto.dealerSocketOpportunityId,
    );
    if (existing) {
      if (existing.rooftopId !== dto.rooftopId)
        throw new ConflictException(
          'This opportunity belongs to a different rooftop; check the entity map',
        );
      await this.store.addEvent({
        id: `sys_${randomUUID()}`,
        prospectId: existing.id,
        type: ThreadEventType.SYSTEM,
        direction: 'internal',
        content: `Repeat opportunity forward received from ${dto.leadSource}.`,
        timestamp: new Date(),
      });
      await this.store.notifyOwner(
        existing,
        'A repeat lead forward was merged into this conversation.',
      );
      return { intakeStatus: 'duplicate_merged', prospect: existing };
    }
    const receivedAt = dto.receivedAt ? new Date(dto.receivedAt) : new Date();
    if (
      Number.isNaN(receivedAt.getTime()) ||
      receivedAt.getTime() > Date.now() + 60000
    )
      throw new BadRequestException('Invalid lead received timestamp');
    const enquiryConsent =
      dto.enquiryConsent ?? !settings.requireExplicitConsent;
    if (dto.enquiryConsent === true && !dto.consentEvidence?.trim())
      throw new BadRequestException(
        'Explicit consent requires an evidence/reference',
      );
    const leadFields = {
      receivedAt,
      leadType: dto.leadType ?? 'new_vehicle_internet',
      consent: {
        enquiryConsent,
        marketingConsent: dto.marketingConsent ?? false,
        evidence:
          dto.consentEvidence?.trim() ||
          (enquiryConsent
            ? 'New lead enquiry response'
            : 'Consent not established'),
        recordedAt: new Date(),
      },
      opportunityAliases: [],
    };
    this.logger.log(
      `Ingesting lead for ${dto.rooftopId} - Opp #${dto.dealerSocketOpportunityId} (${dto.customer.firstName} ${dto.customer.lastName || ''})`,
    );

    // 1. Normalise and validate Australian mobile
    const phoneResult = PhoneNormalizer.normalizeAustralianPhone(
      dto.customer.mobile,
    );

    if (
      !phoneResult.isValid ||
      phoneResult.isLandline ||
      !phoneResult.normalized
    ) {
      this.logger.warn(
        `Invalid phone for lead #${dto.dealerSocketOpportunityId}: ${dto.customer.mobile} (${phoneResult.error})`,
      );

      const invalidProspect: ProspectEntity = {
        ...leadFields,
        id: `pr_${randomUUID()}`,
        dealerSocketOpportunityId: dto.dealerSocketOpportunityId,
        dealerSocketCustomerId: dto.dealerSocketCustomerId,
        rooftopId: dto.rooftopId,
        customer: dto.customer,
        normalizedMobile: phoneResult.normalized || dto.customer.mobile,
        vehicle: dto.vehicle || {},
        leadSource: dto.leadSource,
        assignedTo: dto.salesperson
          ? {
              name: dto.salesperson.name || 'Unassigned',
              email: dto.salesperson.email,
            }
          : undefined,
        status: ProspectStatus.CLOSED,
        journey: {
          status: 'stopped',
          currentStep: 0,
          currentStepName: 'None',
          pausedReason: phoneResult.error || 'Invalid phone or landline',
        },
        unreadInboundCount: 0,
        lastActivityAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.store.saveProspect(invalidProspect);
      await this.store.addEvent({
        id: `sys_${randomUUID()}`,
        prospectId: invalidProspect.id,
        type: ThreadEventType.SYSTEM,
        direction: 'internal',
        content: `Contact skipped: ${phoneResult.error || 'Landline or invalid number cannot receive SMS.'}`,
        timestamp: new Date(),
      });

      await this.writebackService.queueWriteback(
        invalidProspect.id,
        dto.dealerSocketOpportunityId,
        'failed_contact',
        `SMS journey skipped: ${phoneResult.error || 'Invalid phone number'}`,
      );

      return {
        intakeStatus: 'rejected_invalid_number',
        reason: phoneResult.error,
        prospect: invalidProspect,
      };
    }

    const normalizedMobile = phoneResult.normalized!;

    // 2. Check global suppression list
    const isSuppressed =
      await this.complianceService.isMobileSuppressed(normalizedMobile);
    if (isSuppressed) {
      this.logger.warn(
        `Mobile ${normalizedMobile} is in 3-rooftop suppression list`,
      );

      const suppressedProspect: ProspectEntity = {
        ...leadFields,
        id: `pr_${randomUUID()}`,
        dealerSocketOpportunityId: dto.dealerSocketOpportunityId,
        dealerSocketCustomerId: dto.dealerSocketCustomerId,
        rooftopId: dto.rooftopId,
        customer: dto.customer,
        normalizedMobile,
        vehicle: dto.vehicle || {},
        leadSource: dto.leadSource,
        assignedTo: dto.salesperson
          ? {
              name: dto.salesperson.name || 'Unassigned',
              email: dto.salesperson.email,
            }
          : undefined,
        status: ProspectStatus.OPTED_OUT,
        journey: {
          status: 'stopped',
          currentStep: 0,
          currentStepName: 'None',
          pausedReason: 'Number on 3-rooftop suppression list',
        },
        unreadInboundCount: 0,
        lastActivityAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.store.saveProspect(suppressedProspect);
      await this.store.addEvent({
        id: `sys_${randomUUID()}`,
        prospectId: suppressedProspect.id,
        type: ThreadEventType.SYSTEM,
        direction: 'internal',
        content:
          'Contact skipped: Customer previously unsubscribed (suppressed across all 3 rooftops).',
        timestamp: new Date(),
      });

      await this.writebackService.queueWriteback(
        suppressedProspect.id,
        dto.dealerSocketOpportunityId,
        'opted_out',
        'SMS journey not started: Customer is on global suppression list',
      );

      return {
        intakeStatus: 'suppressed',
        reason: 'Number is on global 3-rooftop suppression list',
        prospect: suppressedProspect,
      };
    }

    // 3. Duplicate detection — DealerSocket opportunity ID
    const existingOpp = await this.store.findProspectByOpportunityId(
      dto.dealerSocketOpportunityId,
    );
    if (existingOpp) {
      await this.store.addEvent({
        id: `sys_${randomUUID()}`,
        prospectId: existingOpp.id,
        type: ThreadEventType.SYSTEM,
        direction: 'internal',
        content: `Repeat update received for Opportunity #${dto.dealerSocketOpportunityId} from ${dto.leadSource}.`,
        timestamp: new Date(),
      });
      return { intakeStatus: 'duplicate_merged', prospect: existingOpp };
    }

    // 4. Duplicate detection — same mobile + rooftop inside 14-day window
    const recentProspect =
      await this.store.findRecentProspectByMobileAndRooftop(
        normalizedMobile,
        dto.rooftopId,
        settings.duplicateWindowDays,
      );
    if (recentProspect) {
      this.logger.log(
        `Duplicate lead within 14-day window for ${normalizedMobile} at ${dto.rooftopId}. Merging into thread #${recentProspect.id}.`,
      );
      const vehicleDesc = dto.vehicle?.model
        ? `${dto.vehicle.make || ''} ${dto.vehicle.model}`
        : 'new vehicle';
      await this.store.addEvent({
        id: `sys_${randomUUID()}`,
        prospectId: recentProspect.id,
        type: ThreadEventType.SYSTEM,
        direction: 'internal',
        content: `Duplicate lead received via ${dto.leadSource} for ${vehicleDesc} (Opp #${dto.dealerSocketOpportunityId}). Joined existing open thread.`,
        timestamp: new Date(),
      });
      await this.store.aliasOpportunity(
        recentProspect.id,
        dto.dealerSocketOpportunityId,
      );
      await this.store.notifyOwner(
        recentProspect,
        `Duplicate lead via ${dto.leadSource} merged into this thread.`,
      );
      return {
        intakeStatus: 'duplicate_merged',
        reason: 'Duplicate lead on same mobile & rooftop inside 14-day window',
        prospect: recentProspect,
      };
    }

    // 5. Create new prospect
    const newProspect: ProspectEntity = {
      ...leadFields,
      id: `pr_${randomUUID()}`,
      dealerSocketOpportunityId: dto.dealerSocketOpportunityId,
      dealerSocketCustomerId: dto.dealerSocketCustomerId,
      rooftopId: dto.rooftopId,
      customer: dto.customer,
      normalizedMobile,
      vehicle: dto.vehicle || {},
      leadSource: dto.leadSource,
      assignedTo: dto.salesperson
        ? {
            name: dto.salesperson.name || 'Unassigned',
            email: dto.salesperson.email,
          }
        : undefined,
      status: ProspectStatus.NEW,
      journey: {
        status: 'active',
        currentStep: 0,
        currentStepName: 'Pending Step 1',
        nextScheduledStepAt: nextOpen(
          this.store.getRooftopById(dto.rooftopId)!,
        ),
      },
      unreadInboundCount: 0,
      lastActivityAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.store.saveProspect(newProspect);

    // 6. Check send hours, trigger Step 1 or queue
    const rooftop = this.store.getRooftopById(dto.rooftopId)!;
    const canSendNow = this.journeyService.isWithinSendHours(rooftop);

    const sourceAllowed =
      !settings.qualifyingSources.length ||
      settings.qualifyingSources.includes(dto.leadSource);
    const definition = await this.store.recordGet(
      'journey_active',
      `${dto.rooftopId}:${newProspect.leadType}`,
    );
    const journeyAllowed = definition
      ? definition.data.enabled
      : newProspect.leadType === 'new_vehicle_internet';
    if (!enquiryConsent || !sourceAllowed || !journeyAllowed) {
      await this.store.updateProspect(newProspect.id, {
        journey: {
          ...newProspect.journey,
          status: 'paused',
          pausedReason: !enquiryConsent
            ? 'Consent requires review'
            : !sourceAllowed
              ? 'Lead source is not configured for journeys'
              : 'Journey is unpublished or disabled',
          nextScheduledStepAt: undefined,
        },
      });
      await this.store.createTask(
        newProspect,
        !enquiryConsent
          ? 'Review consent before contacting customer'
          : 'Review journey/source configuration',
        'intake_review',
      );
    } else if (canSendNow) {
      await this.journeyService.startJourneyForProspect(newProspect);
    } else {
      await this.store.addEvent({
        id: `sys_${randomUUID()}`,
        prospectId: newProspect.id,
        type: ThreadEventType.SYSTEM,
        direction: 'internal',
        content: `Lead landed outside quiet hours (9:00–20:00 AEST). Queued for 9:00 AM send.`,
        timestamp: new Date(),
      });
    }

    const saved = await this.store.findProspectById(newProspect.id);
    return {
      intakeStatus: saved?.journey.currentStep
        ? 'journey_started'
        : saved?.journey.status === 'paused'
          ? 'held_for_review'
          : 'queued',
      prospect: saved,
    };
  }
}
