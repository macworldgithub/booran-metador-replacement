import { Injectable, NotFoundException } from '@nestjs/common';
import { StoreService } from '../database/store.service';
import { SmsService } from '../sms/sms.service';
import { JourneyService } from '../journey/journey.service';
import { WritebackService } from '../writeback/writeback.service';
import {
  ThreadEventType,
  ProspectStatus,
  ProspectOutcome,
} from '../../common/enums';
import {
  QueryProspectsDto,
  SendStaffMessageDto,
  AddInternalNoteDto,
  UpdateJourneyDto,
  SetOutcomeDto,
  AssignProspectDto,
} from './dto';

@Injectable()
export class ConversationsService {
  constructor(
    private readonly store: StoreService,
    private readonly smsService: SmsService,
    private readonly journeyService: JourneyService,
    private readonly writebackService: WritebackService,
  ) {}

  getProspects(query: QueryProspectsDto) {
    return this.store.queryProspects({
      rooftopId: query.rooftopId,
      status: query.status,
      ownerName: query.ownerName,
      search: query.search,
    });
  }

  getProspectById(id: string) {
    const prospect = this.store.findProspectById(id);
    if (!prospect) {
      throw new NotFoundException(`Prospect ${id} not found`);
    }

    // Clear unread inbound count when thread is opened in portal
    if (prospect.unreadInboundCount > 0) {
      this.store.updateProspect(id, { unreadInboundCount: 0 });
    }

    return prospect;
  }

  getThread(prospectId: string) {
    const prospect = this.getProspectById(prospectId);
    const events = this.store.getEventsByProspectId(prospectId);

    return {
      prospect,
      totalEvents: events.length,
      events, // strictly ordered chronologically
    };
  }

  async sendStaffMessage(prospectId: string, dto: SendStaffMessageDto) {
    const prospect = this.getProspectById(prospectId);

    // Send SMS via rooftop number
    const event = await this.smsService.sendOutboundSms({
      prospect,
      content: dto.content,
      type: ThreadEventType.STAFF_OUTBOUND,
      authorName: dto.authorName,
    });

    // Write back to DealerSocket
    await this.writebackService.queueWriteback(
      prospect.id,
      prospect.dealerSocketOpportunityId,
      'staff_sms_sent',
      `Staff SMS by ${dto.authorName}: "${dto.content}"`,
    );

    return event;
  }

  addInternalNote(prospectId: string, dto: AddInternalNoteDto) {
    const prospect = this.getProspectById(prospectId);

    const noteEvent = this.store.addEvent({
      id: `note_${Date.now()}`,
      prospectId: prospect.id,
      type: ThreadEventType.INTERNAL_NOTE,
      direction: 'internal',
      content: dto.content,
      authorName: dto.authorName,
      timestamp: new Date(),
    });

    return noteEvent;
  }

  updateJourney(prospectId: string, dto: UpdateJourneyDto) {
    return this.journeyService.manageJourney(
      prospectId,
      dto.action,
      dto.reason,
    );
  }

  async setOutcome(prospectId: string, dto: SetOutcomeDto) {
    const prospect = this.getProspectById(prospectId);

    let newStatus = ProspectStatus.CLOSED;
    if (dto.outcome === ProspectOutcome.APPOINTMENT_REQUESTED) {
      newStatus = ProspectStatus.WAITING_ON_US;
    }

    const updated = this.store.updateProspect(prospectId, {
      outcome: dto.outcome,
      status: newStatus,
      journey: {
        ...prospect.journey,
        status: 'completed',
        pausedReason: `Outcome set: ${dto.outcome}`,
      },
    });

    // Add system event
    this.store.addEvent({
      id: `sys_${Date.now()}`,
      prospectId,
      type: ThreadEventType.SYSTEM,
      direction: 'internal',
      content: `Outcome set to "${dto.outcome}"${dto.notes ? ': ' + dto.notes : ''}. Journey completed.`,
      timestamp: new Date(),
    });

    // Write-back outcome to DealerSocket
    await this.writebackService.queueWriteback(
      prospect.id,
      prospect.dealerSocketOpportunityId,
      `outcome_${dto.outcome}`,
      `Outcome set in portal: ${dto.outcome}. ${dto.notes || ''}`,
    );

    return updated;
  }

  assignProspect(prospectId: string, dto: AssignProspectDto) {
    const prospect = this.getProspectById(prospectId);

    const updated = this.store.updateProspect(prospectId, {
      assignedTo: {
        name: dto.salespersonName,
        email: dto.salespersonEmail,
      },
    });

    this.store.addEvent({
      id: `sys_${Date.now()}`,
      prospectId,
      type: ThreadEventType.SYSTEM,
      direction: 'internal',
      content: `Prospect reassigned to ${dto.salespersonName}.`,
      timestamp: new Date(),
    });

    return updated;
  }
}
