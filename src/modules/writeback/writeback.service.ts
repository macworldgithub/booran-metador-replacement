import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { ThreadEventType, UserRole } from '../../common/enums';
import type { PortalActor } from '../conversations/conversations.service';
import axios, { AxiosInstance } from 'axios';
import { StoreService } from '../database/store.service';
import { WritebackLogEntity } from '../database/entities';

@Injectable()
export class WritebackService {
  private readonly logger = new Logger(WritebackService.name);
  private readonly httpClient: AxiosInstance;
  private readonly isConfigured: boolean;

  constructor(private readonly store: StoreService) {
    const baseUrl =
      process.env.DS_API_BASE_URL || 'https://api.dealersocket.com';
    const clientId = process.env.DS_CLIENT_ID;
    const clientSecret = process.env.DS_CLIENT_SECRET;

    this.isConfigured = !!(
      process.env.DEALERSOCKET_WRITEBACK_ENABLED === 'true' &&
      clientId &&
      clientSecret &&
      !clientId.startsWith('xxx') &&
      process.env.DS_ACTIVITY_PATH
    );

    this.httpClient = axios.create({
      baseURL: baseUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    if (this.isConfigured) {
      this.logger.log(`DealerSocket Solera API client configured (${baseUrl})`);
    } else {
      this.logger.log(
        'DealerSocket write-back is disabled. Read-only mode remains active unless DEALERSOCKET_WRITEBACK_ENABLED=true and verified credentials/path are configured.',
      );
    }
  }

  async queueWriteback(
    prospectId: string,
    opportunityId: string,
    action: string,
    payload: string,
  ): Promise<WritebackLogEntity> {
    const logId = `wb_${randomUUID()}`;

    const log: WritebackLogEntity = {
      id: logId,
      prospectId,
      opportunityId,
      action,
      payload:
        action === 'assignment_changed'
          ? payload
          : `${payload}\nThread: ${process.env.PORTAL_PUBLIC_URL || ''}/?prospect=${prospectId}`,
      status: 'pending',
      attempts: 0,
      createdAt: new Date(),
      simulated: !this.isConfigured,
      nextAttemptAt: new Date(),
    };

    await this.store.addWritebackLog(log);

    // Fire-and-forget async background dispatch (never blocks SMS or inbound processing)
    this.executeDealerSocketSync(log).catch((err) => {
      this.logger.error(
        `DealerSocket write-back failed for log ${log.id}: ${err.message}`,
      );
    });

    return log;
  }

  async executeDealerSocketSync(log: WritebackLogEntity): Promise<void> {
    if (!this.isConfigured) return; // Never report a simulated write-back as CRM success.
    const key = `writeback-opportunity:${log.opportunityId}`;
    const owner = await this.store.lease(key, 60);
    if (!owner) return;
    try {
      const all = await this.store.getWritebackLogs();
      const current = all.find((item) => item.id === log.id);
      if (!current || current.status === 'success') return;
      if (
        all.some(
          (item) =>
            item.opportunityId === log.opportunityId &&
            item.status !== 'success' &&
            new Date(item.createdAt) < new Date(current.createdAt),
        )
      )
        return;
      if (this.isConfigured) {
        try {
          // DealerSocket Solera API call: POST /v1/opportunities/{id}/events or /v1/events
          const assignment = log.action === 'assignment_changed';
          if (assignment && !process.env.DS_ASSIGNMENT_PATH)
            throw new Error(
              'DS_ASSIGNMENT_PATH must be configured for CRM reassignment',
            );
          const path = assignment
            ? process.env.DS_ASSIGNMENT_PATH!
            : process.env.DS_ACTIVITY_PATH!;
          const res = await this.httpClient.request({
            method: assignment ? 'PATCH' : 'POST',
            url: path.replace(
              '{opportunityId}',
              encodeURIComponent(log.opportunityId),
            ),
            data: assignment
              ? { assignedTo: JSON.parse(log.payload) }
              : {
                  type: 'SMS_ACTIVITY',
                  action: log.action,
                  note: log.payload,
                  timestamp: new Date(log.createdAt).toISOString(),
                },
            headers: {
              'X-Client-Id': process.env.DS_CLIENT_ID,
              'X-Client-Secret': process.env.DS_CLIENT_SECRET,
              'Idempotency-Key': log.id,
            },
          });

          this.logger.log(
            `[DealerSocket Write-Back Synced] Opp #${log.opportunityId} → Status ${res.status}`,
          );
          await this.store.updateWritebackLog(log.id, 'success');
          await this.store.scheduleWriteback(log.id, { simulated: false });
          return;
        } catch (err: any) {
          this.logger.warn(
            `DealerSocket API error for Opp #${log.opportunityId}: ${err.message}. Marking failed for retry.`,
          );
          await this.store.updateWritebackLog(log.id, 'failed', err.message);
          await this.store.scheduleWriteback(log.id, {
            simulated: false,
            nextAttemptAt: new Date(
              Date.now() + Math.min(3600000, 30000 * 2 ** current.attempts),
            ),
          });
          if (current.attempts === 0)
            await this.store.addEvent({
              id: `sys_${randomUUID()}`,
              prospectId: log.prospectId,
              type: ThreadEventType.SYSTEM,
              direction: 'internal',
              content:
                'DealerSocket write-back failed. Automatic retry queued; SMS is not blocked.',
              timestamp: new Date(),
            });
          throw err;
        }
      }
    } finally {
      await this.store.releaseLease(key, owner);
    }
  }

  async getLogs(
    status?: 'pending' | 'success' | 'failed',
    user?: PortalActor,
  ): Promise<WritebackLogEntity[]> {
    if (status && !['pending', 'success', 'failed'].includes(status))
      throw new BadRequestException('Invalid write-back status');
    const logs = await this.store.getWritebackLogs(status);
    if (!user || user.role === UserRole.GROUP_ADMIN) return logs;
    const ids = new Set(
      (await this.store.queryProspects({ rooftopIds: user.rooftopIds })).map(
        (p) => p.id,
      ),
    );
    return logs.filter((log) => ids.has(log.prospectId));
  }

  async retryLog(
    logId: string,
    user?: PortalActor,
  ): Promise<WritebackLogEntity | null> {
    const logs = await this.store.getWritebackLogs();
    const log = logs.find((l) => l.id === logId);
    if (!log) throw new NotFoundException('Write-back log not found');
    if (
      user &&
      !(await this.getLogs(undefined, user)).some((item) => item.id === logId)
    )
      throw new ForbiddenException('No access to this write-back');
    if (!this.isConfigured)
      throw new BadRequestException(
        'DealerSocket credentials and verified DS_ACTIVITY_PATH must be configured',
      );
    await this.executeDealerSocketSync(log);
    return (
      (await this.store.getWritebackLogs()).find((item) => item.id === logId) ??
      null
    );
  }
  @Cron('*/30 * * * * *')
  async retryDue() {
    if (!this.isConfigured) return;
    for (const log of await this.store.dueWritebacks()) {
      try {
        await this.executeDealerSocketSync(log);
      } catch (error: any) {
        this.logger.warn(`Retry failed: ${log.id}: ${error.message}`);
      }
    }
  }
}
