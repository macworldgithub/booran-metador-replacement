import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { StoreService } from '../database/store.service';
import { WritebackLogEntity } from '../database/entities';

@Injectable()
export class WritebackService {
  private readonly logger = new Logger(WritebackService.name);
  private readonly httpClient: AxiosInstance;
  private readonly isConfigured: boolean;

  constructor(private readonly store: StoreService) {
    const baseUrl = process.env.DS_API_BASE_URL || 'https://api.dealersocket.com';
    const clientId = process.env.DS_CLIENT_ID;
    const clientSecret = process.env.DS_CLIENT_SECRET;

    this.isConfigured = !!(clientId && clientSecret && !clientId.startsWith('xxx'));

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
        'DealerSocket credentials not provided. Write-back service running in simulation mode with full persistent audit trail.',
      );
    }
  }

  async queueWriteback(
    prospectId: string,
    opportunityId: string,
    action: string,
    payload: string,
  ): Promise<WritebackLogEntity> {
    const logId = `wb_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    const log: WritebackLogEntity = {
      id: logId,
      prospectId,
      opportunityId,
      action,
      payload,
      status: 'pending',
      attempts: 0,
      createdAt: new Date(),
    };

    await this.store.addWritebackLog(log);

    // Fire-and-forget async background dispatch (never blocks SMS or inbound processing)
    this.executeDealerSocketSync(log).catch((err) => {
      this.logger.error(`DealerSocket write-back failed for log ${log.id}: ${err.message}`);
    });

    return log;
  }

  async executeDealerSocketSync(log: WritebackLogEntity): Promise<void> {
    if (this.isConfigured) {
      try {
        // DealerSocket Solera API call: POST /v1/opportunities/{id}/events or /v1/events
        const res = await this.httpClient.post(
          `/v1/opportunities/${encodeURIComponent(log.opportunityId)}/notes`,
          {
            type: 'SMS_ACTIVITY',
            action: log.action,
            note: log.payload,
            timestamp: new Date().toISOString(),
          },
          {
            headers: {
              'X-Client-Id': process.env.DS_CLIENT_ID,
              'X-Client-Secret': process.env.DS_CLIENT_SECRET,
            },
          },
        );

        this.logger.log(
          `[DealerSocket Write-Back Synced] Opp #${log.opportunityId} → Status ${res.status}`,
        );
        await this.store.updateWritebackLog(log.id, 'success');
        return;
      } catch (err: any) {
        this.logger.warn(
          `DealerSocket API error for Opp #${log.opportunityId}: ${err.message}. Marking failed for retry.`,
        );
        await this.store.updateWritebackLog(log.id, 'failed', err.message);
        throw err;
      }
    }

    // Simulation mode: records success in MongoDB
    this.logger.log(
      `[DealerSocket Write-Back (Simulated)] Opp #${log.opportunityId} → Action: ${log.action} | "${log.payload}"`,
    );
    await this.store.updateWritebackLog(log.id, 'success');
  }

  async getLogs(status?: 'pending' | 'success' | 'failed'): Promise<WritebackLogEntity[]> {
    return this.store.getWritebackLogs(status);
  }

  async retryLog(logId: string): Promise<WritebackLogEntity | null> {
    const logs = await this.store.getWritebackLogs();
    const log = logs.find((l) => l.id === logId);
    if (!log) return null;
    await this.executeDealerSocketSync(log);
    return log;
  }
}
