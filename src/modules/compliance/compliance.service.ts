import { Injectable, BadRequestException } from '@nestjs/common';
import { StoreService } from '../database/store.service';
import { PhoneNormalizer } from '../../common/utils/phone-normalizer.util';
import { SuppressionEntity } from '../database/entities';

@Injectable()
export class ComplianceService {
  constructor(private readonly store: StoreService) {}

  async isMobileSuppressed(rawMobile: string): Promise<boolean> {
    const norm = PhoneNormalizer.normalizeAustralianPhone(rawMobile);
    const lookupKey = norm.normalized || rawMobile;
    return this.store.isSuppressed(lookupKey);
  }

  async addSuppression(
    rawMobile: string,
    reason: string,
    source: 'keyword_opt_out' | 'manual_admin' | 'crm_flag' = 'manual_admin',
  ): Promise<SuppressionEntity> {
    const norm = PhoneNormalizer.normalizeAustralianPhone(rawMobile);
    if (!norm.isValid || !norm.normalized) {
      throw new BadRequestException(`Invalid Australian mobile number: ${rawMobile}`);
    }
    return this.store.addSuppression(norm.normalized, reason, source);
  }

  async removeSuppression(rawMobile: string): Promise<boolean> {
    const norm = PhoneNormalizer.normalizeAustralianPhone(rawMobile);
    const key = norm.normalized || rawMobile;
    return this.store.removeSuppression(key);
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
