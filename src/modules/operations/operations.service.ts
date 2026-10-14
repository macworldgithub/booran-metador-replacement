import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { StoreService } from '../database/store.service';
import { PortalActor } from '../conversations/conversations.service';
import { RooftopId, UserRole } from '../../common/enums';
import {
  ConsentDto,
  JourneyDraftDto,
  PlatformSettingsDto,
  ReportQueryDto,
  RooftopSettingsDto,
  TemplateDto,
} from './dto';
import { defaultJourneySteps } from '../journey/default-journey';

@Injectable()
export class OperationsService implements OnModuleInit {
  constructor(private readonly store: StoreService) {}
  async onModuleInit() {
    await this.store.initializeOperations();
    for (const rooftopId of Object.values(RooftopId)) {
      const key = `${rooftopId}:new_vehicle_internet`;
      const owner = await this.store.lease(`seed:${key}`);
      if (!owner) continue;
      try {
        if (!(await this.store.recordGet('journey_active', key))) {
          const id = `default_${rooftopId}_v1`;
          await this.store.recordSave('journey', id, {
            rooftopId,
            leadType: 'new_vehicle_internet',
            name: 'Default new-lead journey',
            steps: defaultJourneySteps,
            status: 'published',
            version: 1,
            publishedAt: new Date(),
            publishedBy: 'system',
          });
          await this.store.recordSave('journey_active', key, {
            id,
            version: 1,
            enabled: true,
          });
        }
      } finally {
        await this.store.releaseLease(`seed:${key}`, owner);
      }
    }
  }
  scope(user: PortalActor, rooftopId?: RooftopId) {
    const ids =
      user.role === UserRole.GROUP_ADMIN
        ? Object.values(RooftopId)
        : user.rooftopIds;
    if (rooftopId && !ids.includes(rooftopId))
      throw new ForbiddenException('No access to this rooftop');
    return rooftopId ? [rooftopId] : ids;
  }
  async saveSettings(dto: PlatformSettingsDto, user: PortalActor) {
    if (
      Object.values(dto.entityMap).some(
        (id) => !Object.values(RooftopId).includes(id),
      )
    )
      throw new BadRequestException(
        'entityMap values must be valid rooftop IDs',
      );
    const result = await this.store.recordSave('settings', 'platform', dto);
    await this.store.audit('settings_updated', user, dto);
    return result!.data;
  }
  async saveRooftop(id: RooftopId, dto: RooftopSettingsDto, user: PortalActor) {
    if (!Object.values(RooftopId).includes(id))
      throw new NotFoundException('Rooftop not found');
    const owner = await this.store.lease('rooftop-settings');
    if (!owner)
      throw new BadRequestException(
        'Rooftop settings are being updated; retry',
      );
    try {
      await this.store.refreshRooftops();
      const result = await this.store.saveRooftop(id, dto);
      await this.store.audit('rooftop_updated', user, {
        rooftopId: id,
        settings: result,
      });
      return result;
    } finally {
      await this.store.releaseLease('rooftop-settings', owner);
    }
  }
  async journeys(user: PortalActor, rooftopId?: RooftopId) {
    return this.store.recordList('journey', {
      'data.rooftopId': { $in: this.scope(user, rooftopId) },
    });
  }
  validateSteps(dto: JourneyDraftDto) {
    if (dto.steps[0].delayType !== 'immediate')
      throw new BadRequestException('The first step must use immediate timing');
    for (const step of dto.steps) {
      const tokens = step.template.match(/{{[^}]+}}/g) ?? [];
      if (
        tokens.some(
          (token) =>
            ![
              '{{firstName}}',
              '{{rooftopName}}',
              '{{brand}}',
              '{{vehicleDesc}}',
              '{{salespersonName}}',
              '{{phone}}',
            ].includes(token),
        )
      )
        throw new BadRequestException('Unknown template merge field');
      if (step.delayType === 'business_hours' && step.delayValue < 1)
        throw new BadRequestException('Business-hour delay must be positive');
      if (step.delayType === 'calendar_days' && step.delayValue > 30)
        throw new BadRequestException(
          'New-lead journeys cannot schedule beyond 30 days',
        );
    }
  }
  async createJourney(dto: JourneyDraftDto, user: PortalActor) {
    this.validateSteps(dto);
    const result = await this.store.recordSave('journey', randomUUID(), {
      ...dto,
      status: 'draft',
      createdBy: user.id,
    });
    await this.store.audit('journey_draft_created', user, { id: result!.key });
    return result;
  }
  async updateJourney(id: string, dto: JourneyDraftDto, user: PortalActor) {
    const owner = await this.store.lease(`journey-edit:${id}`);
    if (!owner)
      throw new BadRequestException(
        'Journey is being edited or published; retry',
      );
    try {
      const current = await this.store.recordGet('journey', id);
      if (!current) throw new NotFoundException('Journey version not found');
      if (current.data.status !== 'draft')
        throw new BadRequestException(
          'Published versions are immutable; create a new draft',
        );
      this.validateSteps(dto);
      const result = await this.store.recordSave('journey', id, {
        ...current.data,
        ...dto,
      });
      await this.store.audit('journey_draft_updated', user, { id });
      return result;
    } finally {
      await this.store.releaseLease(`journey-edit:${id}`, owner);
    }
  }
  async publish(id: string, user: PortalActor) {
    const editOwner = await this.store.lease(`journey-edit:${id}`);
    if (!editOwner)
      throw new BadRequestException(
        'Journey is being edited or published; retry',
      );
    try {
      const current = await this.store.recordGet('journey', id);
      if (!current) throw new NotFoundException('Journey version not found');
      const key = `${current.data.rooftopId}:${current.data.leadType}`;
      const owner = await this.store.lease(`publish:${key}`);
      if (!owner)
        throw new BadRequestException(
          'Another publication is in progress; retry',
        );
      try {
        const latest = await this.store.recordGet('journey', id);
        if (latest!.data.status !== 'draft')
          throw new BadRequestException('Only drafts can be published');
        const active = await this.store.recordGet('journey_active', key);
        const version = (active?.data.version ?? 0) + 1;
        const result = await this.store.recordSave('journey', id, {
          ...latest!.data,
          version,
          status: 'published',
          publishedAt: new Date(),
          publishedBy: user.id,
        });
        await this.store.recordSave('journey_active', key, {
          id,
          version,
          enabled: true,
        });
        await this.store.audit('journey_published', user, { id, version });
        return result;
      } finally {
        await this.store.releaseLease(`publish:${key}`, owner);
      }
    } finally {
      await this.store.releaseLease(`journey-edit:${id}`, editOwner);
    }
  }
  async toggleJourney(id: string, enabled: boolean, user: PortalActor) {
    const current = await this.store.recordGet('journey', id);
    if (!current) throw new NotFoundException('Journey not found');
    const key = `${current.data.rooftopId}:${current.data.leadType}`;
    const owner = await this.store.lease(`publish:${key}`);
    if (!owner)
      throw new BadRequestException(
        'Journey publication is in progress; retry',
      );
    try {
      const active = await this.store.recordGet('journey_active', key);
      if (active?.data.id !== id)
        throw new BadRequestException(
          'Only the current published version can be activated or paused',
        );
      await this.store.recordSave('journey_active', key, {
        ...active.data,
        enabled,
      });
      await this.store.audit('journey_activation_updated', user, {
        id,
        enabled,
      });
      return { id, enabled };
    } finally {
      await this.store.releaseLease(`publish:${key}`, owner);
    }
  }
  async templates(user: PortalActor, rooftopId?: RooftopId) {
    return this.store.recordList('template', {
      'data.rooftopId': { $in: this.scope(user, rooftopId) },
      ...(user.role !== UserRole.GROUP_ADMIN ? { 'data.active': true } : {}),
    });
  }
  async saveTemplate(
    id: string | undefined,
    dto: TemplateDto,
    user: PortalActor,
  ) {
    if (id && !(await this.store.recordGet('template', id)))
      throw new NotFoundException('Template not found');
    this.validateSteps({
      rooftopId: dto.rooftopId,
      name: dto.name,
      leadType: 'template',
      steps: [
        {
          name: dto.name,
          template: dto.content,
          delayType: 'immediate',
          delayValue: 0,
        },
      ],
    });
    const result = await this.store.recordSave(
      'template',
      id ?? randomUUID(),
      dto,
    );
    await this.store.audit('template_saved', user, { id: result!.key });
    return result;
  }
  async archiveTemplate(id: string, user: PortalActor) {
    const current = await this.store.recordGet('template', id);
    if (!current) throw new NotFoundException('Template not found');
    return this.saveTemplate(id, { ...current.data, active: false }, user);
  }
  async accessibleProspect(id: string, user: PortalActor) {
    const prospect = await this.store.findProspectById(id);
    if (!prospect) throw new NotFoundException('Prospect not found');
    this.scope(user, prospect.rooftopId);
    const owner = prospect.assignedTo;
    if (
      user.role === UserRole.SALESPERSON &&
      owner &&
      owner.name !== 'Unassigned' &&
      (owner.id
        ? owner.id !== user.id
        : owner.email
          ? owner.email.toLowerCase() !== user.email.toLowerCase()
          : owner.name !== user.name)
    )
      throw new ForbiddenException('No access to this prospect');
    return prospect;
  }
  async consent(id: string, dto: ConsentDto, user: PortalActor) {
    if (user.role === UserRole.READ_ONLY)
      throw new ForbiddenException('Read-only access');
    const key = `prospect:${id}`;
    const owner = await this.store.lease(key, 120);
    if (!owner) throw new BadRequestException('Conversation is busy; retry');
    try {
      const prospect = await this.accessibleProspect(id, user);
      const consent = {
        ...dto,
        evidence: dto.evidence.trim(),
        recordedAt: new Date(),
        recordedBy: user.id,
      };
      const result = await this.store.updateProspect(id, {
        consent,
        ...(!dto.enquiryConsent
          ? {
              journey: {
                ...prospect.journey,
                status: 'stopped' as const,
                pausedReason: 'Enquiry consent withdrawn',
                nextScheduledStepAt: undefined,
              },
            }
          : {}),
      });
      await this.store.audit('consent_updated', user, {
        prospectId: id,
        consent,
      });
      return result;
    } finally {
      await this.store.releaseLease(key, owner);
    }
  }
  async workQueue(kind: 'task' | 'notification', user: PortalActor) {
    const records = await this.store.recordList(kind, {
      'data.rooftopId': { $in: this.scope(user) },
    });
    return records.filter(
      (item) =>
        user.role !== UserRole.SALESPERSON ||
        !item.data.owner ||
        item.data.owner.name === 'Unassigned' ||
        (item.data.owner.id
          ? item.data.owner.id === user.id
          : item.data.owner.email
            ? item.data.owner.email.toLowerCase() === user.email.toLowerCase()
            : item.data.owner.name === user.name),
    );
  }
  async updateWork(
    kind: 'task' | 'notification',
    id: string,
    value: string | boolean,
    user: PortalActor,
  ) {
    if (user.role === UserRole.READ_ONLY)
      throw new ForbiddenException('Read-only access');
    const record = (await this.workQueue(kind, user)).find(
      (item) => item.key === id,
    );
    if (!record) throw new NotFoundException('Work item not found');
    const result = await this.store.recordSave(kind, id, {
      ...record.data,
      ...(kind === 'task'
        ? { status: value, completedBy: user.id }
        : { read: true }),
    });
    await this.store.audit(`${kind}_updated`, user, { id, value });
    return result;
  }
  async report(query: ReportQueryDto, user: PortalActor, audit = false) {
    if (query.from && query.to && new Date(query.from) > new Date(query.to))
      throw new BadRequestException('from must not be after to');
    const ids = this.scope(user, query.rooftopId);
    const prospects = await this.store.queryProspects({ rooftopIds: ids });
    const filtered = audit
      ? prospects
      : prospects.filter(
          (p) =>
            (!query.from ||
              new Date(p.receivedAt ?? p.createdAt) >= new Date(query.from)) &&
            (!query.to ||
              new Date(p.receivedAt ?? p.createdAt) <= new Date(query.to)),
        );
    const events = await this.store.sendAudit(
      filtered.map((p) => p.id),
      query.from,
      query.to,
    );
    if (audit)
      return {
        generatedAt: new Date(),
        events: events.map((event) => ({
          ...event,
          rooftopId: prospects.find((p) => p.id === event.prospectId)
            ?.rooftopId,
        })),
      };
    return {
      generatedAt: new Date(),
      rooftops: ids.map((id) => {
        const leads = filtered.filter((p) => p.rooftopId === id);
        const outcomes = Object.fromEntries(
          [...new Set(leads.map((p) => p.outcome).filter(Boolean))].map(
            (outcome) => [
              outcome,
              leads.filter((p) => p.outcome === outcome).length,
            ],
          ),
        );
        const firstTimes = leads
          .map((p) => {
            const first = events.find(
              (e) => e.prospectId === p.id && e.type === 'automated_outbound',
            );
            return first
              ? Math.max(
                  0,
                  (new Date(first.timestamp).getTime() -
                    new Date(p.receivedAt ?? p.createdAt).getTime()) /
                    1000,
                )
              : null;
          })
          .filter((n): n is number => n !== null)
          .sort((a, b) => a - b);
        return {
          rooftopId: id,
          totalLeads: leads.length,
          replied: leads.filter((p) => p.lastInboundAt).length,
          replyRate: leads.length
            ? leads.filter((p) => p.lastInboundAt).length / leads.length
            : 0,
          medianFirstSmsSeconds: firstTimes.length
            ? firstTimes.length % 2
              ? firstTimes[Math.floor(firstTimes.length / 2)]
              : (firstTimes[firstTimes.length / 2 - 1] +
                  firstTimes[firstTimes.length / 2]) /
                2
            : null,
          failedSends: events.filter(
            (e) =>
              leads.some((p) => p.id === e.prospectId) &&
              e.deliveryStatus === 'failed',
          ).length,
          outcomes,
        };
      }),
    };
  }
  @Cron('0 0 3 * * *', { timeZone: 'Australia/Melbourne' })
  async retention() {
    const owner = await this.store.lease('retention', 600);
    if (!owner) return;
    try {
      await this.store.retentionPurge();
    } finally {
      await this.store.releaseLease('retention', owner);
    }
  }
}
