import { Injectable, Logger } from '@nestjs/common';
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
    this.logger.log(
      `Ingesting lead for ${dto.rooftopId} - Opp #${dto.dealerSocketOpportunityId} (${dto.customer.firstName} ${dto.customer.lastName || ''})`,
    );

    // 1. Normalise and validate Australian mobile
    const phoneResult = PhoneNormalizer.normalizeAustralianPhone(dto.customer.mobile);

    if (!phoneResult.isValid || phoneResult.isLandline || !phoneResult.normalized) {
      this.logger.warn(
        `Invalid phone for lead #${dto.dealerSocketOpportunityId}: ${dto.customer.mobile} (${phoneResult.error})`,
      );

      const invalidProspect: ProspectEntity = {
        id: `pr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        dealerSocketOpportunityId: dto.dealerSocketOpportunityId,
        dealerSocketCustomerId: dto.dealerSocketCustomerId,
        rooftopId: dto.rooftopId,
        customer: dto.customer,
        normalizedMobile: phoneResult.normalized || dto.customer.mobile,
        vehicle: dto.vehicle || {},
        leadSource: dto.leadSource,
        assignedTo: dto.salesperson
          ? { name: dto.salesperson.name || 'Unassigned', email: dto.salesperson.email }
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
        id: `sys_${Date.now()}`,
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
    const isSuppressed = await this.complianceService.isMobileSuppressed(normalizedMobile);
    if (isSuppressed) {
      this.logger.warn(`Mobile ${normalizedMobile} is in 3-rooftop suppression list`);

      const suppressedProspect: ProspectEntity = {
        id: `pr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        dealerSocketOpportunityId: dto.dealerSocketOpportunityId,
        dealerSocketCustomerId: dto.dealerSocketCustomerId,
        rooftopId: dto.rooftopId,
        customer: dto.customer,
        normalizedMobile,
        vehicle: dto.vehicle || {},
        leadSource: dto.leadSource,
        assignedTo: dto.salesperson
          ? { name: dto.salesperson.name || 'Unassigned', email: dto.salesperson.email }
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
        id: `sys_${Date.now()}`,
        prospectId: suppressedProspect.id,
        type: ThreadEventType.SYSTEM,
        direction: 'internal',
        content: 'Contact skipped: Customer previously unsubscribed (suppressed across all 3 rooftops).',
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
        id: `sys_${Date.now()}`,
        prospectId: existingOpp.id,
        type: ThreadEventType.SYSTEM,
        direction: 'internal',
        content: `Repeat update received for Opportunity #${dto.dealerSocketOpportunityId} from ${dto.leadSource}.`,
        timestamp: new Date(),
      });
      return { intakeStatus: 'duplicate_merged', prospect: existingOpp };
    }

    // 4. Duplicate detection — same mobile + rooftop inside 14-day window
    const recentProspect = await this.store.findRecentProspectByMobileAndRooftop(
      normalizedMobile,
      dto.rooftopId,
      14,
    );
    if (recentProspect) {
      this.logger.log(
        `Duplicate lead within 14-day window for ${normalizedMobile} at ${dto.rooftopId}. Merging into thread #${recentProspect.id}.`,
      );
      const vehicleDesc = dto.vehicle?.model
        ? `${dto.vehicle.make || ''} ${dto.vehicle.model}`
        : 'new vehicle';
      await this.store.addEvent({
        id: `sys_${Date.now()}`,
        prospectId: recentProspect.id,
        type: ThreadEventType.SYSTEM,
        direction: 'internal',
        content: `Duplicate lead received via ${dto.leadSource} for ${vehicleDesc} (Opp #${dto.dealerSocketOpportunityId}). Joined existing open thread.`,
        timestamp: new Date(),
      });
      return {
        intakeStatus: 'duplicate_merged',
        reason: 'Duplicate lead on same mobile & rooftop inside 14-day window',
        prospect: recentProspect,
      };
    }

    // 5. Create new prospect
    const newProspect: ProspectEntity = {
      id: `pr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      dealerSocketOpportunityId: dto.dealerSocketOpportunityId,
      dealerSocketCustomerId: dto.dealerSocketCustomerId,
      rooftopId: dto.rooftopId,
      customer: dto.customer,
      normalizedMobile,
      vehicle: dto.vehicle || {},
      leadSource: dto.leadSource,
      assignedTo: dto.salesperson
        ? { name: dto.salesperson.name || 'Unassigned', email: dto.salesperson.email }
        : undefined,
      status: ProspectStatus.NEW,
      journey: {
        status: 'active',
        currentStep: 0,
        currentStepName: 'Pending Step 1',
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

    if (canSendNow) {
      await this.journeyService.startJourneyForProspect(newProspect);
      await this.writebackService.queueWriteback(
        newProspect.id,
        newProspect.dealerSocketOpportunityId,
        'journey_started',
        `SMS Journey Step 1 started for ${rooftop.name}. Link: /prospects/${newProspect.id}`,
      );
    } else {
      await this.store.addEvent({
        id: `sys_${Date.now()}`,
        prospectId: newProspect.id,
        type: ThreadEventType.SYSTEM,
        direction: 'internal',
        content: `Lead landed outside quiet hours (9:00–20:00 AEST). Queued for 9:00 AM send.`,
        timestamp: new Date(),
      });
    }

    const saved = await this.store.findProspectById(newProspect.id);
    return { intakeStatus: 'journey_started', prospect: saved };
  }
}
