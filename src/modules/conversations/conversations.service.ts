import { Injectable, NotFoundException } from '@nestjs/common';
import { StoreService } from '../database/store.service';
import { SmsService } from '../sms/sms.service';
import { JourneyService } from '../journey/journey.service';
import { WritebackService } from '../writeback/writeback.service';
import {
  ThreadEventType,
  ProspectStatus,
  ProspectOutcome,
  RooftopId,
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

  async getProspects(query: QueryProspectsDto, scopedRooftopIds?: RooftopId[]) {
    return this.store.queryProspects({
      rooftopId: query.rooftopId,
      // RBAC scope: if caller is not group_admin, restrict to their rooftops
      rooftopIds: !query.rooftopId && scopedRooftopIds ? scopedRooftopIds : undefined,
      status: query.status,
      ownerName: query.ownerName,
      search: query.search,
    });
  }

  async getProspectById(id: string) {
    const prospect = await this.store.findProspectById(id);
    if (!prospect) throw new NotFoundException(`Prospect ${id} not found`);

    // Clear unread badge when thread is opened
    if (prospect.unreadInboundCount > 0) {
      await this.store.updateProspect(id, { unreadInboundCount: 0 });
    }

    return prospect;
  }

  async getThread(prospectId: string) {
    const prospect = await this.getProspectById(prospectId);
    const events = await this.store.getEventsByProspectId(prospectId);
    return {
      prospect,
      totalEvents: events.length,
      events,
    };
  }

  async sendStaffMessage(prospectId: string, dto: SendStaffMessageDto) {
    const prospect = await this.getProspectById(prospectId);

    const event = await this.smsService.sendOutboundSms({
      prospect,
      content: dto.content,
      type: ThreadEventType.STAFF_OUTBOUND,
      authorName: dto.authorName,
    });

    await this.writebackService.queueWriteback(
      prospect.id,
      prospect.dealerSocketOpportunityId,
      'staff_sms_sent',
      `Staff SMS by ${dto.authorName}: "${dto.content}"`,
    );

    return event;
  }

  async addInternalNote(prospectId: string, dto: AddInternalNoteDto) {
    const prospect = await this.getProspectById(prospectId);

    return this.store.addEvent({
      id: `note_${Date.now()}`,
      prospectId: prospect.id,
      type: ThreadEventType.INTERNAL_NOTE,
      direction: 'internal',
      content: dto.content,
      authorName: dto.authorName,
      timestamp: new Date(),
    });
  }

  async updateJourney(prospectId: string, dto: UpdateJourneyDto) {
    return this.journeyService.manageJourney(prospectId, dto.action, dto.reason);
  }

  async setOutcome(prospectId: string, dto: SetOutcomeDto) {
    const prospect = await this.getProspectById(prospectId);

    const newStatus =
      dto.outcome === ProspectOutcome.APPOINTMENT_REQUESTED
        ? ProspectStatus.WAITING_ON_US
        : ProspectStatus.CLOSED;

    const updated = await this.store.updateProspect(prospectId, {
      outcome: dto.outcome,
      status: newStatus,
      journey: {
        ...prospect.journey,
        status: 'completed',
        pausedReason: `Outcome set: ${dto.outcome}`,
      },
    });

    await this.store.addEvent({
      id: `sys_${Date.now()}`,
      prospectId,
      type: ThreadEventType.SYSTEM,
      direction: 'internal',
      content: `Outcome set to "${dto.outcome}"${dto.notes ? ': ' + dto.notes : ''}. Journey completed.`,
      timestamp: new Date(),
    });

    await this.writebackService.queueWriteback(
      prospect.id,
      prospect.dealerSocketOpportunityId,
      `outcome_${dto.outcome}`,
      `Outcome set in portal: ${dto.outcome}. ${dto.notes || ''}`,
    );

    return updated;
  }

  async assignProspect(prospectId: string, dto: AssignProspectDto) {
    await this.getProspectById(prospectId);

    const updated = await this.store.updateProspect(prospectId, {
      assignedTo: { name: dto.salespersonName, email: dto.salespersonEmail },
    });

    await this.store.addEvent({
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
