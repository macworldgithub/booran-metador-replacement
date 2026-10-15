import { BadGatewayException } from '@nestjs/common';
import { RooftopId, UserRole } from '../../common/enums';
import type { PortalActor } from '../conversations/conversations.service';

export const liveRooftops = [
  { id: 'cranbourne_kia', name: 'Cranbourne Kia' },
  { id: 'cranbourne_mg', name: 'Cranbourne MG' },
  { id: 'geely_cranbourne', name: 'Geely Cranbourne' },
];
export interface LiveDealerSocketLead {
  id: string; opportunityId: string; customerId: string; rooftopId: string; rooftop: string;
  customerName: string; mobile: string; email: string; vehicle: string; source: string;
  owner: string; status: string; sourceTimestamp: string; sourceTimestampBasis: string;
  observedAt: string | null; detailsObservedAt: string | null; detailsVerified: boolean;
  missingFields: string; warnings: string;
}
export interface LiveLeadSnapshot {
  state: 'idle' | 'running' | 'complete' | 'partial' | 'error'; jobId: string | null;
  snapshotState: 'complete' | 'partial' | null;
  schedule: { enabled: boolean; intervalSeconds: number; nextRunAt: string | null };
  startedAt: string | null; fetchedAt: string | null; completedAt: string | null;
  durationSeconds: number | null; progress: string | null; errorCode: string | null;
  readOnly: true; limited: boolean; records: LiveDealerSocketLead[];
  rooftops: { id: string; name: string; recordCount: number; matchedCandidateCount: number | null }[];
  issues: string[]; coverageNote: string;
}
type Raw = Record<string, unknown>;
const object = (v: unknown): Raw => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new BadGatewayException('Invalid live lead snapshot');
  return v as Raw;
};
const text = (v: unknown, max = 500): string => typeof v === 'string' ? v.slice(0, max) : '';
const date = (v: unknown): string | null => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null;
const count = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;

// This is the authorization boundary. Never return the raw multi-rooftop connector result.
export function sanitizeLiveLeads(value: unknown, actor: PortalActor): LiveLeadSnapshot {
  const raw = object(value);
  if (!['idle','running','complete','partial','error'].includes(String(raw.state)) || raw.readOnly !== true)
    throw new BadGatewayException('Invalid live lead snapshot');
  const admin = actor.role === UserRole.GROUP_ADMIN;
  const allowed = liveRooftops.filter(roof => admin || actor.rooftopIds?.includes(roof.id as RooftopId));
  const snapshotState = ['complete','partial'].includes(String(raw.state)) ? raw.state :
    ['complete','partial'].includes(String(raw.snapshotState)) && date(raw.fetchedAt) ? raw.snapshotState : null;
  const finished = snapshotState !== null;
  if (finished && (!Array.isArray(raw.records) || raw.records.length > 1000))
    throw new BadGatewayException('Invalid live lead records');
  const records: LiveDealerSocketLead[] = [];
  for (const value of finished ? raw.records as unknown[] : []) {
    const row = object(value);
    const roof = liveRooftops.find(roof => roof.name === row.rooftop);
    if (!roof || !text(row.opportunity_id) || !text(row.customer_id) || !text(row.record_key))
      throw new BadGatewayException('Invalid live lead identity');
    if (!allowed.some(item => item.id === roof.id)) continue;
    // CRM salesperson IDs are not portal user IDs. Use the explicit assignment name;
    // missing assignment evidence must not grant access to a salesperson.
    const owner = text(row.assigned_salesperson, 200);
    if (actor.role === UserRole.SALESPERSON &&
        !(typeof row.assigned_salesperson === 'string' &&
          (!owner.trim() || owner.trim().toLowerCase() === 'unassigned' ||
           owner.trim().toLowerCase() === actor.name.trim().toLowerCase()))) continue;
    records.push({
      id: text(row.record_key, 250), opportunityId: text(row.opportunity_id, 150), customerId: text(row.customer_id, 150),
      rooftopId: roof.id, rooftop: roof.name, customerName: text(row.customer_name, 250),
      mobile: text(row.customer_phone, 40), email: text(row.customer_email, 320), vehicle: text(row.vehicle_of_interest),
      source: text(row.lead_source, 250), owner, status: text(row.opportunity_status, 150),
      sourceTimestamp: text(row.received_timestamp, 100), sourceTimestampBasis: text(row.received_timestamp_basis, 150),
      observedAt: date(row.list_observed_at), detailsObservedAt: date(row.detail_observed_at),
      detailsVerified: row.detail_extracted === true, missingFields: text(row.missing_fields, 1000),
      warnings: text(row.validation_warnings, 1000),
    });
  }
  const progress = raw.progress && typeof raw.progress === 'object' ? text((raw.progress as Raw).stage, 80) : '';
  const issues: string[] = [];
  if (finished) {
    if (raw.limited === true) issues.push('Snapshot record limit reached. Some matching records are not shown.');
    if (records.some(row => !row.detailsVerified)) issues.push('Some rows contain queue data only; contact details were not verified.');
    if (admin && Array.isArray(raw.errors) && raw.errors.length) issues.push(`${raw.errors.length} queue/detail read issues were reported.`);
    if (admin && Array.isArray(raw.review) && raw.review.length) issues.push(`${raw.review.length} records require scope or access review.`);
  }
  return {
    state: raw.state as LiveLeadSnapshot['state'], jobId: text(raw.jobId, 100) || null,
    snapshotState: snapshotState as LiveLeadSnapshot['snapshotState'],
    schedule: (() => {
      const schedule = raw.schedule && typeof raw.schedule === 'object' ? raw.schedule as Raw : {};
      const interval = count(schedule.intervalSeconds);
      return { enabled: schedule.enabled === true, intervalSeconds: interval !== null && interval >= 300 && interval <= 86400 ? interval : 3600,
        nextRunAt: schedule.enabled === true ? date(schedule.nextRunAt) : null };
    })(),
    startedAt: date(raw.startedAt), fetchedAt: date(raw.fetchedAt), completedAt: date(raw.completedAt),
    durationSeconds: count(raw.totalDurationSeconds) ?? count(raw.durationSeconds),
    progress: ['checking_session','opening_opportunities','reading_filter_catalog','reading_queue','reading_details'].includes(progress) ? progress : null,
    errorCode: raw.state === 'error' ? (raw.code === 'login_required' ? 'login_required' : 'snapshot_unavailable') : null,
    readOnly: true, limited: raw.limited === true, records,
    rooftops: allowed.map(roof => ({ ...roof, recordCount: records.filter(row => row.rooftopId === roof.id).length,
      matchedCandidateCount: admin && finished && Array.isArray(raw.rooftops)
        ? count((raw.rooftops.find(v => v && typeof v === 'object' && (v as Raw).name === roof.name) as Raw | undefined)?.matchedCandidateCount)
        : null })),
    issues, coverageNote: 'Fresh selected-queue snapshot. Assigned, source or date filters can hide other CRM leads. Newly observed records are not proof of new-lead eligibility.',
  };
}
