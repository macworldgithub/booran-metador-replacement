import { Injectable, Logger } from '@nestjs/common';
import {
  RooftopId,
  ProspectStatus,
  ThreadEventType,
  DeliveryStatus,
} from '../../common/enums';
import {
  RooftopEntity,
  ProspectEntity,
  ThreadEventEntity,
  SuppressionEntity,
  WritebackLogEntity,
} from './entities';

@Injectable()
export class StoreService {
  private readonly logger = new Logger(StoreService.name);

  // In-memory collections
  private readonly rooftops = new Map<RooftopId, RooftopEntity>();
  private readonly prospects = new Map<string, ProspectEntity>();
  private readonly threadEvents: ThreadEventEntity[] = [];
  private readonly suppressionList = new Map<string, SuppressionEntity>();
  private readonly writebackLogs = new Map<string, WritebackLogEntity>();

  constructor() {
    this.seedRooftops();
  }

  private seedRooftops() {
    const defaultRooftops: RooftopEntity[] = [
      {
        id: RooftopId.CRANBOURNE_KIA,
        name: 'Cranbourne Kia',
        address: '209 South Gippsland Hwy, Cranbourne VIC 3977',
        senderPhone: '+61488800209',
        displayPhone: '(03) 5995 0000',
        sendHours: { start: '09:00', end: '20:00' },
        closedDays: ['Sunday'],
      },
      {
        id: RooftopId.CRANBOURNE_MG,
        name: 'Cranbourne MG',
        address: '215 South Gippsland Hwy, Cranbourne VIC 3977',
        senderPhone: '+61488800215',
        displayPhone: '(03) 5995 1111',
        sendHours: { start: '09:00', end: '20:00' },
        closedDays: ['Sunday'],
      },
      {
        id: RooftopId.GEELY_CRANBOURNE,
        name: 'Geely Cranbourne',
        address: '217A South Gippsland Hwy, Cranbourne VIC 3977',
        senderPhone: '+61488800217',
        displayPhone: '(03) 5995 2222',
        sendHours: { start: '09:00', end: '20:00' },
        closedDays: ['Sunday'],
      },
    ];

    for (const r of defaultRooftops) {
      this.rooftops.set(r.id, r);
    }
    this.logger.log('Seeded 3 Cranbourne rooftops: Kia, MG, Geely');
  }

  // --- Rooftops ---
  getRooftops(): RooftopEntity[] {
    return Array.from(this.rooftops.values());
  }

  getRooftopById(id: RooftopId): RooftopEntity | undefined {
    return this.rooftops.get(id);
  }

  getRooftopBySenderPhone(phone: string): RooftopEntity | undefined {
    return Array.from(this.rooftops.values()).find(
      (r) => r.senderPhone === phone,
    );
  }

  // --- Prospects ---
  saveProspect(prospect: ProspectEntity): ProspectEntity {
    this.prospects.set(prospect.id, prospect);
    return prospect;
  }

  findProspectById(id: string): ProspectEntity | undefined {
    return this.prospects.get(id);
  }

  findProspectByOpportunityId(oppId: string): ProspectEntity | undefined {
    return Array.from(this.prospects.values()).find(
      (p) => p.dealerSocketOpportunityId === oppId,
    );
  }

  findRecentProspectByMobileAndRooftop(
    mobile: string,
    rooftopId: RooftopId,
    daysWindow: number = 14,
  ): ProspectEntity | undefined {
    const cutoff = new Date(Date.now() - daysWindow * 24 * 60 * 60 * 1000);
    return Array.from(this.prospects.values()).find(
      (p) =>
        p.normalizedMobile === mobile &&
        p.rooftopId === rooftopId &&
        p.createdAt >= cutoff,
    );
  }

  updateProspect(
    id: string,
    updates: Partial<ProspectEntity>,
  ): ProspectEntity | undefined {
    const existing = this.prospects.get(id);
    if (!existing) return undefined;
    const updated = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };
    this.prospects.set(id, updated);
    return updated;
  }

  queryProspects(filter: {
    rooftopId?: RooftopId;
    status?: ProspectStatus;
    ownerName?: string;
    search?: string;
  }): ProspectEntity[] {
    let result = Array.from(this.prospects.values());

    if (filter.rooftopId) {
      result = result.filter((p) => p.rooftopId === filter.rooftopId);
    }
    if (filter.status) {
      result = result.filter((p) => p.status === filter.status);
    }
    if (filter.ownerName) {
      result = result.filter(
        (p) =>
          p.assignedTo?.name.toLowerCase() === filter.ownerName?.toLowerCase(),
      );
    }
    if (filter.search) {
      const q = filter.search.toLowerCase();
      result = result.filter(
        (p) =>
          p.customer.firstName.toLowerCase().includes(q) ||
          p.customer.lastName?.toLowerCase().includes(q) ||
          p.customer.mobile.includes(q) ||
          p.dealerSocketOpportunityId.toLowerCase().includes(q) ||
          p.vehicle.model?.toLowerCase().includes(q),
      );
    }

    // Default sort: last inbound first, or last activity desc
    result.sort((a, b) => {
      const aTime = a.lastInboundAt?.getTime() || a.lastActivityAt.getTime();
      const bTime = b.lastInboundAt?.getTime() || b.lastActivityAt.getTime();
      return bTime - aTime;
    });

    return result;
  }

  // --- Thread Events ---
  addEvent(event: ThreadEventEntity): ThreadEventEntity {
    this.threadEvents.push(event);

    // Update prospect lastActivityAt
    const prospect = this.prospects.get(event.prospectId);
    if (prospect) {
      const updates: Partial<ProspectEntity> = {
        lastActivityAt: event.timestamp,
      };
      if (event.type === ThreadEventType.CUSTOMER_INBOUND) {
        updates.lastInboundAt = event.timestamp;
        updates.unreadInboundCount = (prospect.unreadInboundCount || 0) + 1;
      }
      this.updateProspect(prospect.id, updates);
    }

    return event;
  }

  getEventsByProspectId(prospectId: string): ThreadEventEntity[] {
    return this.threadEvents
      .filter((e) => e.prospectId === prospectId)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  updateEventStatus(
    eventId: string,
    status: DeliveryStatus,
    failureReason?: string,
  ): ThreadEventEntity | undefined {
    const event = this.threadEvents.find((e) => e.id === eventId);
    if (!event) return undefined;
    event.deliveryStatus = status;
    if (failureReason) event.failureReason = failureReason;
    return event;
  }

  // --- Suppression (Global 3-Rooftop) ---
  isSuppressed(mobile: string): boolean {
    return this.suppressionList.has(mobile);
  }

  addSuppression(
    mobile: string,
    reason: string,
    source: 'keyword_opt_out' | 'manual_admin' | 'crm_flag',
  ): SuppressionEntity {
    const entry: SuppressionEntity = {
      mobile,
      reason,
      source,
      createdAt: new Date(),
    };
    this.suppressionList.set(mobile, entry);
    this.logger.warn(`Mobile ${mobile} added to 3-rooftop global suppression: ${reason}`);
    return entry;
  }

  removeSuppression(mobile: string): boolean {
    return this.suppressionList.delete(mobile);
  }

  getSuppressionList(): SuppressionEntity[] {
    return Array.from(this.suppressionList.values());
  }

  // --- Writeback Logs ---
  addWritebackLog(log: WritebackLogEntity): WritebackLogEntity {
    this.writebackLogs.set(log.id, log);
    return log;
  }

  getWritebackLogs(status?: 'pending' | 'success' | 'failed'): WritebackLogEntity[] {
    let logs = Array.from(this.writebackLogs.values());
    if (status) {
      logs = logs.filter((l) => l.status === status);
    }
    return logs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  updateWritebackLog(
    id: string,
    status: 'pending' | 'success' | 'failed',
    error?: string,
  ): WritebackLogEntity | undefined {
    const log = this.writebackLogs.get(id);
    if (!log) return undefined;
    log.status = status;
    log.attempts += 1;
    log.lastAttemptAt = new Date();
    if (error) log.error = error;
    return log;
  }
}
