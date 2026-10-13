import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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
import { Prospect } from './schemas/prospect.schema';
import { ThreadEvent } from './schemas/thread-event.schema';
import { Suppression } from './schemas/suppression.schema';
import { WritebackLog } from './schemas/writeback-log.schema';

@Injectable()
export class StoreService {
  private readonly logger = new Logger(StoreService.name);

  // Rooftops remain static config (not stored in DB)
  private readonly rooftops = new Map<RooftopId, RooftopEntity>();

  constructor(
    @InjectModel(Prospect.name) private readonly prospectModel: Model<Prospect>,
    @InjectModel(ThreadEvent.name) private readonly threadEventModel: Model<ThreadEvent>,
    @InjectModel(Suppression.name) private readonly suppressionModel: Model<Suppression>,
    @InjectModel(WritebackLog.name) private readonly writebackLogModel: Model<WritebackLog>,
  ) {
    this.seedRooftops();
  }

  private seedRooftops() {
    const defaultRooftops: RooftopEntity[] = [
      {
        id: RooftopId.CRANBOURNE_KIA,
        name: 'Cranbourne Kia',
        address: '209 South Gippsland Hwy, Cranbourne VIC 3977',
        senderPhone: process.env.TWILIO_KIA_NUMBER || '+61488800209',
        displayPhone: '(03) 5995 0000',
        sendHours: { start: '09:00', end: '20:00' },
        closedDays: ['Sunday'],
      },
      {
        id: RooftopId.CRANBOURNE_MG,
        name: 'Cranbourne MG',
        address: '215 South Gippsland Hwy, Cranbourne VIC 3977',
        senderPhone: process.env.TWILIO_MG_NUMBER || '+61488800215',
        displayPhone: '(03) 5995 1111',
        sendHours: { start: '09:00', end: '20:00' },
        closedDays: ['Sunday'],
      },
      {
        id: RooftopId.GEELY_CRANBOURNE,
        name: 'Geely Cranbourne',
        address: '217A South Gippsland Hwy, Cranbourne VIC 3977',
        senderPhone: process.env.TWILIO_GEELY_NUMBER || '+61488800217',
        displayPhone: '(03) 5995 2222',
        sendHours: { start: '09:00', end: '20:00' },
        closedDays: ['Sunday'],
      },
    ];
    for (const r of defaultRooftops) {
      this.rooftops.set(r.id, r);
    }
    this.logger.log('Rooftop config loaded: Cranbourne Kia, MG, Geely');
  }

  // Helper: strip MongoDB internal fields, return plain entity
  private toEntity<T>(doc: any): T {
    if (!doc) return null as any;
    const { _id, __v, ...rest } = doc;
    return rest as T;
  }

  // ─── Rooftops (in-memory static config) ──────────────────────────────────
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

  // ─── Prospects ───────────────────────────────────────────────────────────
  async saveProspect(prospect: ProspectEntity): Promise<ProspectEntity> {
    const created = await this.prospectModel.create(prospect);
    return this.toEntity<ProspectEntity>(created.toObject());
  }

  async findProspectById(id: string): Promise<ProspectEntity | null> {
    const doc = await this.prospectModel.findOne({ id }).lean();
    return doc ? this.toEntity<ProspectEntity>(doc) : null;
  }

  async findProspectByOpportunityId(oppId: string): Promise<ProspectEntity | null> {
    const doc = await this.prospectModel
      .findOne({ dealerSocketOpportunityId: oppId })
      .lean();
    return doc ? this.toEntity<ProspectEntity>(doc) : null;
  }

  async findRecentProspectByMobileAndRooftop(
    mobile: string,
    rooftopId: RooftopId,
    daysWindow = 14,
  ): Promise<ProspectEntity | null> {
    const cutoff = new Date(Date.now() - daysWindow * 24 * 60 * 60 * 1000);
    const doc = await this.prospectModel
      .findOne({
        normalizedMobile: mobile,
        rooftopId,
        createdAt: { $gte: cutoff },
      })
      .sort({ createdAt: -1 })
      .lean();
    return doc ? this.toEntity<ProspectEntity>(doc) : null;
  }

  async updateProspect(
    id: string,
    updates: Partial<ProspectEntity>,
  ): Promise<ProspectEntity | null> {
    const doc = await this.prospectModel
      .findOneAndUpdate(
        { id },
        { $set: { ...updates, updatedAt: new Date() } },
        { new: true },
      )
      .lean();
    return doc ? this.toEntity<ProspectEntity>(doc) : null;
  }

  async findDueJourneys(asOf = new Date()): Promise<ProspectEntity[]> {
    const docs = await this.prospectModel
      .find({
        'journey.status': 'active',
        'journey.nextScheduledStepAt': { $lte: asOf },
      })
      .lean();
    return docs.map((doc) => this.toEntity<ProspectEntity>(doc));
  }


  async queryProspects(filter: {
    rooftopId?: RooftopId;
    rooftopIds?: RooftopId[];   // for RBAC-scoped queries
    status?: ProspectStatus;
    ownerName?: string;
    search?: string;
  }): Promise<ProspectEntity[]> {
    const query: Record<string, any> = {};

    if (filter.rooftopId) {
      query.rooftopId = filter.rooftopId;
    } else if (filter.rooftopIds && filter.rooftopIds.length > 0) {
      query.rooftopId = { $in: filter.rooftopIds };
    }

    if (filter.status) query.status = filter.status;

    if (filter.ownerName) {
      query['assignedTo.name'] = { $regex: filter.ownerName, $options: 'i' };
    }

    if (filter.search) {
      const re = { $regex: filter.search, $options: 'i' };
      query.$or = [
        { 'customer.firstName': re },
        { 'customer.lastName': re },
        { 'customer.mobile': re },
        { dealerSocketOpportunityId: re },
        { 'vehicle.model': re },
      ];
    }

    const docs = await this.prospectModel
      .find(query)
      .sort({ lastInboundAt: -1, lastActivityAt: -1 })
      .lean();

    return docs.map((d) => this.toEntity<ProspectEntity>(d));
  }

  // ─── Thread Events ────────────────────────────────────────────────────────
  async addEvent(event: ThreadEventEntity): Promise<ThreadEventEntity> {
    await this.threadEventModel.create(event);

    // Atomically update prospect activity fields
    const setOps: Record<string, any> = { lastActivityAt: event.timestamp };
    const incOps: Record<string, any> = {};

    if (event.type === ThreadEventType.CUSTOMER_INBOUND) {
      setOps.lastInboundAt = event.timestamp;
      incOps.unreadInboundCount = 1;
    }

    await this.prospectModel.updateOne(
      { id: event.prospectId },
      {
        $set: setOps,
        ...(Object.keys(incOps).length ? { $inc: incOps } : {}),
      },
    );

    return event;
  }

  async getEventsByProspectId(prospectId: string): Promise<ThreadEventEntity[]> {
    const docs = await this.threadEventModel
      .find({ prospectId })
      .sort({ timestamp: 1 })
      .lean();
    return docs.map((d) => this.toEntity<ThreadEventEntity>(d));
  }

  async updateEventStatus(
    eventId: string,
    status: DeliveryStatus,
    failureReason?: string,
  ): Promise<ThreadEventEntity | null> {
    const update: Record<string, any> = { deliveryStatus: status };
    if (failureReason) update.failureReason = failureReason;

    const doc = await this.threadEventModel
      .findOneAndUpdate({ id: eventId }, { $set: update }, { new: true })
      .lean();
    return doc ? this.toEntity<ThreadEventEntity>(doc) : null;
  }

  // ─── Global 3-Rooftop Suppression ────────────────────────────────────────
  async isSuppressed(mobile: string): Promise<boolean> {
    const doc = await this.suppressionModel.findOne({ mobile }).lean();
    return !!doc;
  }

  async addSuppression(
    mobile: string,
    reason: string,
    source: 'keyword_opt_out' | 'manual_admin' | 'crm_flag',
  ): Promise<SuppressionEntity> {
    // upsert so re-subscribing then re-unsubscribing is handled cleanly
    const doc = await this.suppressionModel.findOneAndUpdate(
      { mobile },
      { $set: { reason, source } },
      { upsert: true, new: true },
    ).lean();
    this.logger.warn(`Mobile ${mobile} added to 3-rooftop global suppression: ${reason}`);
    return this.toEntity<SuppressionEntity>(doc);
  }

  async removeSuppression(mobile: string): Promise<boolean> {
    const result = await this.suppressionModel.deleteOne({ mobile });
    return result.deletedCount > 0;
  }

  async getSuppressionList(): Promise<SuppressionEntity[]> {
    const docs = await this.suppressionModel.find().sort({ createdAt: -1 }).lean();
    return docs.map((d) => this.toEntity<SuppressionEntity>(d));
  }

  // ─── Writeback Logs ───────────────────────────────────────────────────────
  async addWritebackLog(log: WritebackLogEntity): Promise<WritebackLogEntity> {
    const created = await this.writebackLogModel.create(log);
    return this.toEntity<WritebackLogEntity>(created.toObject());
  }

  async getWritebackLogs(status?: 'pending' | 'success' | 'failed'): Promise<WritebackLogEntity[]> {
    const query = status ? { status } : {};
    const docs = await this.writebackLogModel
      .find(query)
      .sort({ createdAt: -1 })
      .lean();
    return docs.map((d) => this.toEntity<WritebackLogEntity>(d));
  }

  async updateWritebackLog(
    id: string,
    status: 'pending' | 'success' | 'failed',
    error?: string,
  ): Promise<WritebackLogEntity | null> {
    const update: Record<string, any> = {
      status,
      lastAttemptAt: new Date(),
      $inc: { attempts: 1 },
    };
    if (error) update.error = error;

    const doc = await this.writebackLogModel
      .findOneAndUpdate({ id }, update, { new: true })
      .lean();
    return doc ? this.toEntity<WritebackLogEntity>(doc) : null;
  }
}
