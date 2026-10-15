import {
  RooftopId,
  ProspectStatus,
  ThreadEventType,
  DeliveryStatus,
  ProspectOutcome,
} from '../../../common/enums';

export interface RooftopEntity {
  id: RooftopId;
  name: string;
  address: string;
  senderPhone: string;
  displayPhone: string;
  sendHours: {
    start: string; // e.g. "09:00"
    end: string; // e.g. "20:00"
  };
  closedDays: string[];
}

export interface CustomerInfo {
  firstName: string;
  lastName?: string;
  mobile: string;
  email?: string;
}

export interface VehicleInfo {
  make?: string;
  model?: string;
  year?: number;
  isNew?: boolean;
  stockNumber?: string;
  comments?: string;
}

export interface AssignedStaff {
  name: string;
  email?: string;
  id?: string;
}

export interface JourneyState {
  versionId?: string;
  version?: number;
  leadType?: string;
  startedAt?: Date;
  status: 'active' | 'paused' | 'completed' | 'stopped';
  currentStep: number;
  currentStepName: string;
  pausedReason?: string;
  lastStepSentAt?: Date;
  nextScheduledStepAt?: Date;
}

export interface ProspectEntity {
  sourceSync?: {
    mode: 'lead_forward' | 'live_scrape' | 'backfill';
    fingerprint?: string;
    scrapedAt?: Date;
    sourceUrl?: string;
  };
  receivedAt?: Date;
  leadType?: string;
  consent?: {
    enquiryConsent: boolean;
    marketingConsent: boolean;
    evidence: string;
    recordedAt: Date;
    recordedBy?: string;
  };
  opportunityAliases?: string[];
  id: string;
  dealerSocketOpportunityId: string;
  dealerSocketCustomerId?: string;
  rooftopId: RooftopId;
  customer: CustomerInfo;
  normalizedMobile: string;
  vehicle: VehicleInfo;
  leadSource: string;
  assignedTo?: AssignedStaff;
  status: ProspectStatus;
  journey: JourneyState;
  outcome?: ProspectOutcome;
  unreadInboundCount: number;
  lastInboundAt?: Date;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ThreadEventEntity {
  id: string;
  prospectId: string;
  type: ThreadEventType;
  direction: 'outbound' | 'inbound' | 'internal';
  content: string;
  authorName?: string;
  journeyStepName?: string;
  deliveryStatus?: DeliveryStatus;
  failureReason?: string;
  mediaUrls?: string[];
  metadata?: Record<string, any>;
  timestamp: Date;
}

export interface SuppressionEntity {
  mobile: string; // E.164 +614...
  reason: string;
  source: 'keyword_opt_out' | 'manual_admin' | 'crm_flag';
  createdAt: Date;
}

export interface WritebackLogEntity {
  simulated?: boolean;
  nextAttemptAt?: Date;
  id: string;
  prospectId: string;
  opportunityId: string;
  action: string;
  payload: string;
  status: 'pending' | 'success' | 'failed';
  attempts: number;
  lastAttemptAt?: Date;
  error?: string;
  createdAt: Date;
}
