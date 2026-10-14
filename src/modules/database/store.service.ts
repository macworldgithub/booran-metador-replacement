import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
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
    @InjectModel(ThreadEvent.name)
    private readonly threadEventModel: Model<ThreadEvent>,
    @InjectModel(Suppression.name)
    private readonly suppressionModel: Model<Suppression>,
    @InjectModel(WritebackLog.name)
    private readonly writebackLogModel: Model<WritebackLog>,
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

  async findProspectByOpportunityId(
    oppId: string,
  ): Promise<ProspectEntity | null> {
    const doc = await this.prospectModel
      .findOne({
        $or: [
          { dealerSocketOpportunityId: oppId },
          { opportunityAliases: oppId },
        ],
      })
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
        status: { $nin: [ProspectStatus.CLOSED, ProspectStatus.OPTED_OUT] },
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
        $or: [
          { 'journey.nextScheduledStepAt': { $lte: asOf } },
          {
            'journey.currentStep': 0,
            'journey.nextScheduledStepAt': { $exists: false },
          },
        ],
      })
      .lean();
    return docs.map((doc) => this.toEntity<ProspectEntity>(doc));
  }

  async queryProspects(filter: {
    rooftopId?: RooftopId;
    rooftopIds?: RooftopId[]; // for RBAC-scoped queries
    status?: ProspectStatus;
    ownerName?: string;
    search?: string;
    source?: string;
    landedFrom?: string;
    landedTo?: string;
    ownership?: 'mine' | 'unassigned';
    actor?: { id: string; email: string; name: string };
  }): Promise<ProspectEntity[]> {
    const query: Record<string, any> = {};

    if (filter.rooftopId) {
      query.rooftopId = filter.rooftopId;
    } else if (filter.rooftopIds !== undefined) {
      query.rooftopId = { $in: filter.rooftopIds };
    }

    if (filter.status) query.status = filter.status;
    if (filter.source) query.leadSource = filter.source;
    if (filter.landedFrom || filter.landedTo) {
      const range = {
        ...(filter.landedFrom ? { $gte: new Date(filter.landedFrom) } : {}),
        ...(filter.landedTo ? { $lte: new Date(filter.landedTo) } : {}),
      };
      query.$and = [
        {
          $or: [
            { receivedAt: range },
            { receivedAt: { $exists: false }, createdAt: range },
          ],
        },
      ];
    }
    if (filter.ownership === 'unassigned')
      query.$and = [
        ...(query.$and ?? []),
        {
          $or: [
            { assignedTo: { $exists: false } },
            { 'assignedTo.name': 'Unassigned' },
            { 'assignedTo.name': { $exists: false } },
          ],
        },
      ];
    if (filter.ownership === 'mine' && filter.actor)
      query.$and = [
        ...(query.$and ?? []),
        {
          $or: [
            { 'assignedTo.id': filter.actor.id },
            { 'assignedTo.email': filter.actor.email },
            { 'assignedTo.name': filter.actor.name },
          ],
        },
      ];

    if (filter.ownerName) {
      const escapedOwner = filter.ownerName.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&',
      );
      query['assignedTo.name'] = { $regex: escapedOwner, $options: 'i' };
    }

    if (filter.search) {
      const escapedSearch = filter.search.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&',
      );
      const re = { $regex: escapedSearch, $options: 'i' };
      query.$or = [
        { 'customer.firstName': re },
        { 'customer.lastName': re },
        { 'customer.mobile': re },
        { normalizedMobile: re },
        { dealerSocketOpportunityId: re },
        { 'vehicle.model': re },
      ];
    }

    const docs = await this.prospectModel
      .find(query)
      .sort({ lastInboundAt: -1, lastActivityAt: -1 })
      .lean();

    const recent = docs.length
      ? await this.threadEventModel.aggregate([
          {
            $match: {
              prospectId: { $in: docs.map((d) => d.id) },
              type: {
                $in: [
                  ThreadEventType.AUTOMATED_OUTBOUND,
                  ThreadEventType.STAFF_OUTBOUND,
                  ThreadEventType.CUSTOMER_INBOUND,
                ],
              },
            },
          },
          { $sort: { timestamp: -1, _id: -1 } },
          { $group: { _id: '$prospectId', lastMessage: { $first: '$$ROOT' } } },
        ])
      : [];
    const latest = new Map(recent.map((item) => [item._id, item.lastMessage]));
    return docs.map((d) => ({
      ...this.toEntity<ProspectEntity>(d),
      lastMessageDirection: latest.get(d.id)?.direction,
      lastMessagePreview: latest.get(d.id)?.content ?? '',
    }));
  }

  // ─── Thread Events ────────────────────────────────────────────────────────
  async addEvent(event: ThreadEventEntity): Promise<ThreadEventEntity> {
    try {
      await this.threadEventModel.create(event);
    } catch (error: any) {
      if (error.code !== 11000) throw error;
      const existing = await this.threadEventModel
        .findOne({ id: event.id })
        .lean();
      if (!existing) throw error;
      return this.toEntity<ThreadEventEntity>(existing);
    }

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

  async getEventsByProspectId(
    prospectId: string,
  ): Promise<ThreadEventEntity[]> {
    const docs = await this.threadEventModel
      .find({ prospectId })
      .sort({ timestamp: 1, _id: 1 })
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
      .findOneAndUpdate(
        {
          $or: [{ id: eventId }, { 'metadata.twilioMessageSid': eventId }],
          ...(status === DeliveryStatus.PENDING
            ? {
                deliveryStatus: {
                  $nin: [DeliveryStatus.DELIVERED, DeliveryStatus.FAILED],
                },
              }
            : status === DeliveryStatus.FAILED
              ? { deliveryStatus: { $ne: DeliveryStatus.DELIVERED } }
              : {}),
        },
        { $set: update },
        { new: true },
      )
      .lean();
    if (doc) return this.toEntity<ThreadEventEntity>(doc);
    const current = await this.threadEventModel
      .findOne({
        $or: [{ id: eventId }, { 'metadata.twilioMessageSid': eventId }],
      })
      .lean();
    return current ? this.toEntity<ThreadEventEntity>(current) : null;
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
    const doc = await this.suppressionModel
      .findOneAndUpdate(
        { mobile },
        { $set: { reason, source } },
        { upsert: true, new: true },
      )
      .lean();
    this.logger.warn(
      `Mobile ${mobile} added to 3-rooftop global suppression: ${reason}`,
    );
    return this.toEntity<SuppressionEntity>(doc);
  }

  async removeSuppression(mobile: string): Promise<boolean> {
    const result = await this.suppressionModel.deleteOne({ mobile });
    return result.deletedCount > 0;
  }

  async getSuppressionList(): Promise<SuppressionEntity[]> {
    const docs = await this.suppressionModel
      .find()
      .sort({ createdAt: -1 })
      .lean();
    return docs.map((d) => this.toEntity<SuppressionEntity>(d));
  }

  // ─── Writeback Logs ───────────────────────────────────────────────────────
  async addWritebackLog(log: WritebackLogEntity): Promise<WritebackLogEntity> {
    const created = await this.writebackLogModel.create(log);
    return this.toEntity<WritebackLogEntity>(created.toObject());
  }

  async getWritebackLogs(
    status?: 'pending' | 'success' | 'failed',
  ): Promise<WritebackLogEntity[]> {
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

  // Operational records use a single indexed collection; DTOs govern each record kind.
  private records() {
    return this.prospectModel.db.db!.collection<any>('portal_records');
  }
  async initializeOperations() {
    await this.records().createIndex({ kind: 1, key: 1 }, { unique: true });
    await this.records().createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0 },
    );
    await this.refreshRooftops();
  }
  async refreshRooftops() {
    for (const record of await this.records()
      .find({ kind: 'rooftop' })
      .toArray())
      this.rooftops.set(record.key, record.data);
  }
  async recordList(kind: string, filter: Record<string, any> = {}) {
    const records = await this.records()
      .find({ kind, ...filter })
      .sort({ createdAt: -1, key: 1 })
      .toArray();
    return records.map(({ _id, kind: _kind, ...record }) => record);
  }
  async recordGet(kind: string, key: string) {
    const record = await this.records().findOne({ kind, key });
    if (!record) return null;
    const { _id, kind: _kind, ...rest } = record;
    return rest;
  }
  async recordSave(kind: string, key: string, data: any) {
    const now = new Date();
    await this.records().updateOne(
      { kind, key },
      { $set: { data, updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true },
    );
    return this.recordGet(kind, key);
  }
  async recordDelete(kind: string, key: string) {
    return (await this.records().deleteOne({ kind, key })).deletedCount > 0;
  }
  async audit(
    action: string,
    actor: { id?: string; name?: string } | undefined,
    details: any,
  ) {
    return this.recordSave('audit', randomUUID(), {
      action,
      actorId: actor?.id,
      actorName: actor?.name ?? 'System',
      details,
      timestamp: new Date(),
    });
  }
  async getSettings() {
    return (
      (await this.recordGet('settings', 'platform'))?.data ?? {
        duplicateWindowDays: 14,
        retentionMonths: 24,
        retentionEnabled: false,
        qualifyingSources: [],
        requireExplicitConsent: false,
        entityMap: {},
      }
    );
  }
  async saveRooftop(id: RooftopId, data: any) {
    const rooftop = {
      id,
      name: data.name.trim(),
      address: data.address.trim(),
      senderPhone: data.senderPhone,
      displayPhone: data.displayPhone.trim(),
      sendHours: { start: data.start, end: data.end },
      closedDays: data.closedDays,
    };
    if (data.start < '09:00' || data.end > '20:00' || data.start >= data.end)
      throw new BadRequestException(
        'Automated send hours must be inside 09:00–20:00 Melbourne time',
      );
    const others = this.getRooftops().filter((item) => item.id !== id);
    if (others.some((item) => item.senderPhone === data.senderPhone))
      throw new ConflictException(
        'Each rooftop must have its own sending number',
      );
    await this.recordSave('rooftop', id, rooftop);
    this.rooftops.set(id, rooftop);
    return rooftop;
  }
  async lease(key: string, seconds = 60) {
    const owner = randomUUID();
    const now = new Date();
    try {
      const record = await this.records().findOneAndUpdate(
        { kind: 'lease', key, expiresAt: { $lte: now } },
        {
          $set: { owner, expiresAt: new Date(now.getTime() + seconds * 1000) },
        },
        { upsert: true, returnDocument: 'after' },
      );
      return record?.owner === owner ? owner : null;
    } catch (error: any) {
      if (error.code === 11000) return null;
      throw error;
    }
  }
  async releaseLease(key: string, owner: string) {
    await this.records().deleteOne({ kind: 'lease', key, owner });
  }
  async latestProspectForMobile(mobile: string, rooftopId: RooftopId) {
    const doc = await this.prospectModel
      .findOne({ normalizedMobile: mobile, rooftopId })
      .sort({ lastActivityAt: -1 })
      .lean();
    return doc ? this.toEntity<ProspectEntity>(doc) : null;
  }
  async claimCarrierMessage(id: string) {
    try {
      await this.records().insertOne({
        kind: 'carrier_message',
        key: id,
        data: { state: 'processing' },
        createdAt: new Date(),
      });
      return true;
    } catch (error: any) {
      if (error.code === 11000) return false;
      throw error;
    }
  }
  async createTask(prospect: ProspectEntity, reason: string, eventKey: string) {
    return this.recordSave('task', `${prospect.id}:${eventKey}`, {
      prospectId: prospect.id,
      rooftopId: prospect.rooftopId,
      owner: prospect.assignedTo,
      reason,
      status: 'open',
    });
  }
  async notifyOwner(prospect: ProspectEntity, content: string) {
    return this.recordSave('notification', randomUUID(), {
      prospectId: prospect.id,
      rooftopId: prospect.rooftopId,
      owner: prospect.assignedTo,
      content,
      read: false,
    });
  }
  async aliasOpportunity(id: string, opportunityId: string) {
    await this.prospectModel.updateOne(
      { id },
      { $addToSet: { opportunityAliases: opportunityId } },
    );
  }
  async sendAudit(ids: string[], from?: string, to?: string) {
    const timestamp = {
      ...(from ? { $gte: new Date(from) } : {}),
      ...(to ? { $lte: new Date(to) } : {}),
    };
    const docs = await this.threadEventModel
      .find({
        prospectId: { $in: ids },
        direction: 'outbound',
        ...(Object.keys(timestamp).length ? { timestamp } : {}),
      })
      .sort({ timestamp: 1, _id: 1 })
      .lean();
    return docs.map((doc) => this.toEntity<ThreadEventEntity>(doc));
  }
  async suppressMobileJourneys(mobile: string) {
    const records = await this.prospectModel
      .find({ normalizedMobile: mobile })
      .lean();
    await this.prospectModel.updateMany(
      { normalizedMobile: mobile },
      {
        $set: {
          status: ProspectStatus.OPTED_OUT,
          'journey.status': 'stopped',
          'journey.pausedReason': 'Global suppression',
          updatedAt: new Date(),
        },
        $unset: { 'journey.nextScheduledStepAt': '' },
      },
    );
    return records.map((record) => this.toEntity<ProspectEntity>(record));
  }
  async dueWritebacks() {
    const docs = await this.writebackLogModel
      .find({
        status: { $in: ['pending', 'failed'] },
        attempts: { $lt: 8 },
        $or: [
          { nextAttemptAt: { $lte: new Date() } },
          { nextAttemptAt: { $exists: false } },
        ],
      })
      .sort({ createdAt: 1, id: 1 })
      .limit(100)
      .lean();
    return docs.map((doc) => this.toEntity<WritebackLogEntity>(doc));
  }
  async scheduleWriteback(id: string, patch: any) {
    await this.writebackLogModel.updateOne({ id }, { $set: patch });
  }
  async retentionPreview() {
    const settings = await this.getSettings();
    const cutoff = new Date();
    cutoff.setUTCMonth(cutoff.getUTCMonth() - settings.retentionMonths);
    const count = await this.prospectModel.countDocuments({
      lastActivityAt: { $lt: cutoff },
      'journey.status': { $in: ['completed', 'stopped'] },
    });
    return {
      cutoff,
      count,
      enabled: settings.retentionEnabled,
      retentionMonths: settings.retentionMonths,
    };
  }
  async retentionPurge() {
    const preview = await this.retentionPreview();
    if (!preview.enabled) return preview;
    const old = await this.prospectModel
      .find({
        lastActivityAt: { $lt: preview.cutoff },
        'journey.status': { $in: ['completed', 'stopped'] },
      })
      .select('id')
      .limit(500)
      .lean();
    let deleted = 0;
    for (const item of old) {
      const key = `prospect:${item.id}`;
      const owner = await this.lease(key, 120);
      if (!owner) continue;
      try {
        const current = await this.findProspectById(item.id);
        if (
          !current ||
          new Date(current.lastActivityAt) >= preview.cutoff ||
          !['completed', 'stopped'].includes(current.journey.status)
        )
          continue;
        await this.threadEventModel.deleteMany({ prospectId: item.id });
        await this.writebackLogModel.deleteMany({ prospectId: item.id });
        await this.records().deleteMany({
          $or: [
            {
              kind: { $in: ['task', 'notification'] },
              'data.prospectId': item.id,
            },
            { kind: 'audit', 'data.details.prospectId': item.id },
          ],
        });
        await this.prospectModel.deleteOne({ id: item.id });
        deleted++;
      } finally {
        await this.releaseLease(key, owner);
      }
    }
    await this.audit('retention_purge', undefined, {
      count: deleted,
      cutoff: preview.cutoff,
    });
    return { ...preview, deleted };
  }
}
