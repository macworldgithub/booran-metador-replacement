import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { StoreService } from '../database/store.service';
import { SmsService } from '../sms/sms.service';
import { JourneyService } from '../journey/journey.service';
import { WritebackService } from '../writeback/writeback.service';
import {
  ThreadEventType,
  ProspectStatus,
  ProspectOutcome,
  RooftopId,
  UserRole,
} from '../../common/enums';
import type { ProspectEntity } from '../database/entities';
import {
  QueryProspectsDto,
  SendStaffMessageDto,
  AddInternalNoteDto,
  UpdateJourneyDto,
  SetOutcomeDto,
  AssignProspectDto,
} from './dto';

export interface PortalActor {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  rooftopIds: RooftopId[];
}

@Injectable()
export class ConversationsService {
  constructor(
    private readonly store: StoreService,
    private readonly smsService: SmsService,
    private readonly journeyService: JourneyService,
    private readonly writebackService: WritebackService,
  ) {}

  private canAccess(prospect: ProspectEntity, user: PortalActor): boolean {
    if (user.role === UserRole.GROUP_ADMIN) return true;
    if (!user.rooftopIds?.includes(prospect.rooftopId)) return false;
    if (user.role !== UserRole.SALESPERSON) return true;
    const owner = prospect.assignedTo;
    if (!owner?.name || owner.name === 'Unassigned') return true;
    if (owner.id) return owner.id === user.id;
    if (owner.email)
      return owner.email.toLowerCase() === user.email.toLowerCase();
    return owner.name === user.name;
  }

  private assertMutation(user: PortalActor, reassign = false) {
    if (
      user.role === UserRole.READ_ONLY ||
      (reassign &&
        ![UserRole.GROUP_ADMIN, UserRole.BDC, UserRole.SALES_MANAGER].includes(
          user.role,
        ))
    )
      throw new ForbiddenException('Your role cannot perform this action');
  }

  async getProspects(query: QueryProspectsDto, user: PortalActor) {
    if (
      query.rooftopId &&
      user.role !== UserRole.GROUP_ADMIN &&
      !user.rooftopIds?.includes(query.rooftopId)
    )
      throw new ForbiddenException('No access to this rooftop');
    const prospects = await this.store.queryProspects({
      rooftopId: query.rooftopId,
      rooftopIds:
        user.role === UserRole.GROUP_ADMIN
          ? undefined
          : (user.rooftopIds ?? []),
      status: query.status,
      ownerName: query.ownerName,
      search: query.search,
    });
    return prospects.filter((p) => this.canAccess(p, user));
  }

  private async accessibleProspect(id: string, user: PortalActor) {
    const prospect = await this.store.findProspectById(id);
    if (!prospect) throw new NotFoundException(`Prospect ${id} not found`);
    if (!this.canAccess(prospect, user))
      throw new ForbiddenException('No access to this prospect');
    return prospect;
  }

  async getProspectById(id: string, user: PortalActor) {
    const prospect = await this.accessibleProspect(id, user);
    if (prospect.unreadInboundCount > 0)
      return (
        (await this.store.updateProspect(id, { unreadInboundCount: 0 })) ??
        prospect
      );
    return prospect;
  }

  async getThread(id: string, user: PortalActor) {
    const prospect = await this.getProspectById(id, user);
    const events = await this.store.getEventsByProspectId(id);
    return { prospect, totalEvents: events.length, events };
  }

  async sendStaffMessage(
    id: string,
    dto: SendStaffMessageDto,
    user: PortalActor,
  ) {
    this.assertMutation(user);
    const prospect = await this.accessibleProspect(id, user);
    if (prospect.status === ProspectStatus.OPTED_OUT)
      throw new BadRequestException('Opted-out prospects cannot receive SMS');
    const rooftop = this.store.getRooftopById(prospect.rooftopId);
    if (!rooftop) throw new NotFoundException('Rooftop not found');
    let content = dto.content.trim();
    if (!content.includes(rooftop.name)) content += `\n\n${rooftop.name}`;
    if (!content.includes(rooftop.displayPhone))
      content += ` · ${rooftop.displayPhone}`;
    if (!/reply\s+STOP/i.test(content)) content += ' · Reply STOP to opt out.';
    const event = await this.smsService.sendOutboundSms({
      prospect,
      content,
      type: ThreadEventType.STAFF_OUTBOUND,
      authorName: user.name,
    });
    await this.writebackService.queueWriteback(
      prospect.id,
      prospect.dealerSocketOpportunityId,
      event.deliveryStatus === 'failed' ? 'staff_sms_failed' : 'staff_sms_sent',
      `Staff SMS by ${user.name}: "${event.content}"`,
    );
    return event;
  }

  async addInternalNote(
    id: string,
    dto: AddInternalNoteDto,
    user: PortalActor,
  ) {
    this.assertMutation(user);
    await this.accessibleProspect(id, user);
    return this.store.addEvent({
      id: `note_${randomUUID()}`,
      prospectId: id,
      type: ThreadEventType.INTERNAL_NOTE,
      direction: 'internal',
      content: dto.content.trim(),
      authorName: user.name,
      timestamp: new Date(),
    });
  }

  async updateJourney(id: string, dto: UpdateJourneyDto, user: PortalActor) {
    this.assertMutation(user);
    await this.accessibleProspect(id, user);
    return this.journeyService.manageJourney(id, dto.action, dto.reason);
  }

  async setOutcome(id: string, dto: SetOutcomeDto, user: PortalActor) {
    this.assertMutation(user);
    const prospect = await this.accessibleProspect(id, user);
    if (prospect.status === ProspectStatus.OPTED_OUT)
      throw new BadRequestException(
        'An opted-out prospect must remain opted out',
      );
    const updated = await this.store.updateProspect(id, {
      outcome: dto.outcome,
      status:
        dto.outcome === ProspectOutcome.APPOINTMENT_REQUESTED
          ? ProspectStatus.WAITING_ON_US
          : ProspectStatus.CLOSED,
      journey: {
        ...prospect.journey,
        status: 'completed',
        nextScheduledStepAt: undefined,
        pausedReason: `Outcome set: ${dto.outcome}`,
      },
    });
    await this.store.addEvent({
      id: `sys_${randomUUID()}`,
      prospectId: id,
      type: ThreadEventType.SYSTEM,
      direction: 'internal',
      content: `Outcome set to "${dto.outcome}"${dto.notes ? ': ' + dto.notes : ''}. Journey completed.`,
      timestamp: new Date(),
    });
    await this.writebackService.queueWriteback(
      id,
      prospect.dealerSocketOpportunityId,
      `outcome_${dto.outcome}`,
      `Outcome set in portal: ${dto.outcome}. ${dto.notes || ''}`,
    );
    return updated;
  }

  async assignProspect(id: string, dto: AssignProspectDto, user: PortalActor) {
    this.assertMutation(user, true);
    const prospect = await this.accessibleProspect(id, user);
    const updated = await this.store.updateProspect(id, {
      assignedTo: {
        name: dto.salespersonName.trim(),
        email: dto.salespersonEmail?.trim().toLowerCase(),
      },
    });
    await this.store.addEvent({
      id: `sys_${randomUUID()}`,
      prospectId: id,
      type: ThreadEventType.SYSTEM,
      direction: 'internal',
      content: `Prospect reassigned to ${dto.salespersonName.trim()} by ${user.name}.`,
      timestamp: new Date(),
    });
    await this.writebackService.queueWriteback(
      id,
      prospect.dealerSocketOpportunityId,
      'assignment_changed',
      `Prospect reassigned to ${dto.salespersonName.trim()} (${dto.salespersonEmail ?? ''}) by ${user.name}.`,
    );
    return updated;
  }
}
