import { Injectable, BadRequestException } from '@nestjs/common';
import { StoreService } from '../database/store.service';
import { PhoneNormalizer } from '../../common/utils/phone-normalizer.util';
import { SuppressionEntity } from '../database/entities';
import { WritebackService } from '../writeback/writeback.service';
import type { PortalActor } from '../conversations/conversations.service';

@Injectable()
export class ComplianceService {
  constructor(
    private readonly store: StoreService,
    private readonly writeback: WritebackService,
  ) {}

  async isMobileSuppressed(rawMobile: string): Promise<boolean> {
    const norm = PhoneNormalizer.normalizeAustralianPhone(rawMobile);
    const lookupKey = norm.normalized || rawMobile;
    return this.store.isSuppressed(lookupKey);
  }

  async addSuppression(
    rawMobile: string,
    reason: string,
    source: 'keyword_opt_out' | 'manual_admin' | 'crm_flag' = 'manual_admin',
    actor?: PortalActor,
  ): Promise<SuppressionEntity> {
    const norm = PhoneNormalizer.normalizeAustralianPhone(rawMobile);
    if (!norm.isValid || !norm.isMobile || !norm.normalized) {
      throw new BadRequestException(
        `Invalid Australian mobile number: ${rawMobile}`,
      );
    }
    const result = await this.store.addSuppression(
      norm.normalized,
      reason.trim(),
      source,
    );
    const prospects = await this.store.suppressMobileJourneys(norm.normalized);
    await this.store.audit('suppression_added', actor, {
      mobile: norm.normalized,
      reason: reason.trim(),
      source,
    });
    for (const prospect of prospects)
      await this.writeback.queueWriteback(
        prospect.id,
        prospect.dealerSocketOpportunityId,
        'opted_out',
        `${new Date().toISOString()} | Global suppression (${source}): ${reason}`,
      );
    return result;
  }

  async removeSuppression(
    rawMobile: string,
    actor?: PortalActor,
  ): Promise<boolean> {
    const norm = PhoneNormalizer.normalizeAustralianPhone(rawMobile);
    if (!norm.isMobile || !norm.normalized)
      throw new BadRequestException('Invalid Australian mobile');
    const success = await this.store.removeSuppression(norm.normalized);
    if (success) {
      await this.store.audit('suppression_removed', actor, {
        mobile: norm.normalized,
      });
      await this.store.recordDelete('optout_confirmation', norm.normalized);
    }
    return success;
  }

  async getAllSuppressions(): Promise<SuppressionEntity[]> {
    return this.store.getSuppressionList();
  }

  async getAuditLog() {
    const suppressions = await this.store.getSuppressionList();
    return {
      generatedAt: new Date().toISOString(),
      complianceStandard: 'Spam Act 2003 / ACMA Compliant',
      totalSuppressedNumbers: suppressions.length,
      suppressions,
    };
  }
}
