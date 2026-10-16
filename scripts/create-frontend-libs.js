const fs = require('fs');
const path = require('path');

const LIB_DIR = 'D:/Hammad/metador-replacement-frontend/lib';

// 1. lib/journeys.ts
fs.writeFileSync(path.join(LIB_DIR, 'journeys.ts'), `"use client";

export type JourneyStep = {
  name: string;
  template: string;
  delayType: "immediate" | "business_hours" | "next_morning" | "calendar_days";
  delayValue: number;
  requiresMarketingConsent?: boolean;
};

export type JourneyRecord = {
  key: string;
  data: {
    rooftopId: string;
    leadType: string;
    name: string;
    steps: JourneyStep[];
    status: "draft" | "published";
    version?: number;
    publishedAt?: string;
    publishedBy?: string;
  };
};

export async function fetchJourneys(rooftopId?: string): Promise<JourneyRecord[]> {
  const url = new URL("/api/journeys", window.location.origin);
  if (rooftopId) url.searchParams.set("rooftopId", rooftopId);
  const res = await fetch(url.toString(), { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) throw new Error("Could not load journeys.");
  return res.json();
}

export async function activateJourney(id: string): Promise<{ id: string; enabled: boolean }> {
  const res = await fetch(\`/api/journeys/\${id}/activate\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Could not activate journey.");
  }
  return res.json();
}

export async function pauseJourney(id: string): Promise<{ id: string; enabled: boolean }> {
  const res = await fetch(\`/api/journeys/\${id}/pause\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Could not pause journey.");
  }
  return res.json();
}
`, 'utf8');

// 2. lib/reports.ts
fs.writeFileSync(path.join(LIB_DIR, 'reports.ts'), `"use client";

export type RooftopPerformance = {
  rooftopId: string;
  totalLeads: number;
  replied: number;
  replyRate: number;
  medianFirstSmsSeconds: number | null;
  failedSends: number;
  outcomes: Record<string, number>;
};

export type PerformanceReport = {
  generatedAt: string;
  rooftops: RooftopPerformance[];
};

export async function fetchPerformance(rooftopId?: string): Promise<PerformanceReport> {
  const url = new URL("/api/reports/journey-performance", window.location.origin);
  if (rooftopId) url.searchParams.set("rooftopId", rooftopId);
  const res = await fetch(url.toString(), { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) throw new Error("Could not load journey performance.");
  return res.json();
}
`, 'utf8');

// 3. lib/writeback.ts
fs.writeFileSync(path.join(LIB_DIR, 'writeback.ts'), `"use client";

export type WritebackLog = {
  id: string;
  prospectId: string;
  opportunityId: string;
  rooftopId: string;
  eventType: string;
  messageBody?: string;
  status: "pending" | "success" | "failed";
  retryCount: number;
  lastAttemptAt?: string;
  lastError?: string;
  createdAt: string;
};

export async function fetchWritebackLogs(status?: "pending" | "success" | "failed"): Promise<WritebackLog[]> {
  const url = new URL("/api/writeback/logs", window.location.origin);
  if (status) url.searchParams.set("status", status);
  const res = await fetch(url.toString(), { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) throw new Error("Could not load CRM write-back logs.");
  return res.json();
}

export async function retryWriteback(id: string): Promise<boolean> {
  const res = await fetch(\`/api/writeback/retry/\${id}\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Write-back retry failed.");
  }
  const data = await res.json();
  return !!data.success;
}
`, 'utf8');

// 4. lib/notifications.ts
fs.writeFileSync(path.join(LIB_DIR, 'notifications.ts'), `"use client";

export type SystemNotification = {
  key: string;
  data: {
    rooftopId: string;
    title: string;
    message: string;
    kind: "duplicate_lead" | "handoff" | "system";
    read?: boolean;
    createdAt?: string;
  };
};

export async function fetchNotifications(): Promise<SystemNotification[]> {
  const res = await fetch("/api/notifications", { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) return [];
  return res.json();
}

export async function markNotificationRead(id: string): Promise<void> {
  await fetch(\`/api/notifications/\${id}/read\`, {
    method: "PATCH",
    credentials: "same-origin",
  });
}
`, 'utf8');

// 5. lib/rooftops.ts
fs.writeFileSync(path.join(LIB_DIR, 'rooftops.ts'), `"use client";

export type Rooftop = {
  id: string;
  name: string;
  address: string;
  displayPhone: string;
  senderPhone: string;
  brand: string;
};

export async function fetchRooftops(): Promise<Rooftop[]> {
  const res = await fetch("/api/rooftops", { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) return [];
  return res.json();
}
`, 'utf8');

console.log('Frontend lib files created successfully');
