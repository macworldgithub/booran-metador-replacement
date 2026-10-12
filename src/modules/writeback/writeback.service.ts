import { Injectable, Logger } from '@nestjs/common';
import { StoreService } from '../database/store.service';
import { WritebackLogEntity } from '../database/entities';

@Injectable()
export class WritebackService {
  private readonly logger = new Logger(WritebackService.name);

  constructor(private readonly store: StoreService) {}

  /**
   * Enqueues an activity/work-note write-back to DealerSocket.
   * CRM API calls are asynchronous and never block live SMS delivery.
   */
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

    this.store.addWritebackLog(log);

    // Simulate immediate asynchronous background dispatch to DealerSocket API
    this.executeDealerSocketSync(log).catch((err) => {
      this.logger.error(`DealerSocket write-back failed for log ${log.id}: ${err.message}`);
    });

    return log;
  }

  private async executeDealerSocketSync(log: WritebackLogEntity): Promise<void> {
    // In production, this calls DealerSocket Solera Work-Note / Activity API.
    // Simulating successful write-back
    this.logger.log(
      `[DealerSocket Write-Back Sync] Opportunity #${log.opportunityId} -> Action: ${log.action} | Detail: "${log.payload}"`,
    );

    this.store.updateWritebackLog(log.id, 'success');
  }

  getLogs(status?: 'pending' | 'success' | 'failed'): WritebackLogEntity[] {
    return this.store.getWritebackLogs(status);
  }

  async retryLog(logId: string): Promise<WritebackLogEntity | undefined> {
    const logs = this.store.getWritebackLogs();
    const log = logs.find((l) => l.id === logId);
    if (!log) return undefined;

    await this.executeDealerSocketSync(log);
    return log;
  }
}
