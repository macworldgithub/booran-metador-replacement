# Remaining scope backend implementation

The backend adds persistent operational configuration and workflow records in `portal_records`, indexed by kind/key. It retains the existing five backend roles. No frontend configuration screens were changed in this backend implementation.

Restart the backend and open `http://localhost:3000/api/docs`. Authenticate using the current `/api/auth/login` token and Swagger **Authorize**. New protected endpoints use the existing Bearer authentication and database-backed role checks.

## APIs

| Methods | Path | Access / purpose |
| --- | --- | --- |
| GET, PATCH | `/api/settings` | Group Admin: duplicate window, consent requirements, retention and entity map |
| PATCH | `/api/rooftops/{id}` | Group Admin: sending identity, contact, quiet hours and closed days |
| GET, POST | `/api/journeys` | Group Admin: list versions / create draft |
| PATCH | `/api/journeys/{id}` | Group Admin: edit draft only |
| POST | `/api/journeys/{id}/publish` | Group Admin: immutable publication for new enrolments |
| POST | `/api/journeys/{id}/activate` | Enable new enrolment in the current published version |
| POST | `/api/journeys/{id}/pause` | Pause new enrolment; existing journeys are controlled per prospect |
| GET, POST | `/api/templates` | Scoped template read / Group Admin create |
| PATCH, DELETE | `/api/templates/{id}` | Group Admin update / archive |
| PATCH | `/api/prospects/{id}/consent` | Authorised non-read-only users: recorded consent evidence |
| GET | `/api/tasks` | Scoped handoff and intake-review tasks |
| PATCH | `/api/tasks/{id}` | Authorised user completes/reopens task |
| GET | `/api/notifications` | Scoped duplicate, customer reply and handoff notifications |
| PATCH | `/api/notifications/{id}/read` | Mark authorised notification read |
| GET | `/api/reports/journey-performance` | Group Admin / Sales Manager: scoped lead/reply/timing/failure/outcome metrics |
| GET | `/api/compliance/send-audit` | Group Admin: chronological outbound messages with actor and version metadata |
| GET | `/api/compliance/activity-audit` | Group Admin: configuration, consent, assignment and suppression history |
| GET | `/api/settings/retention-preview` | Group Admin: preview eligible records; does not delete anything |
| GET | `/api/writeback/exceptions` | Group Admin / scoped manager: failed CRM entries |

Configuration/work-item responses contain `{ key, data, createdAt, updatedAt }`. Use the returned `key` as `{id}`. Drafts have no publication version until published. A published version cannot be edited; clone its data into a new POST draft. Startup creates the default five-step v1 journey for each rooftop if no active definition exists.

`GET /api/prospects` additionally accepts `source`, `landedFrom`, `landedTo` and `ownership=mine|unassigned`. Dates must be ISO dates. Legacy leads without `receivedAt` use `createdAt` for date filtering. Reports/send audit accept `rooftopId`, `from` and `to`.

Staff `POST /api/prospects/{id}/messages` accepts either `content` or an active same-rooftop `templateId`. Supported tokens are `{{firstName}}`, `{{rooftopName}}`, `{{brand}}`, `{{vehicleDesc}}`, `{{salespersonName}}` and `{{phone}}`. Every commercial send appends missing rooftop name, contact path and Reply STOP. The final body is limited to 1600 characters.

## Configuration examples

`PATCH /api/settings` accepts a complete settings object:

```json
{
  "duplicateWindowDays": 14,
  "retentionMonths": 24,
  "retentionEnabled": false,
  "qualifyingSources": [],
  "requireExplicitConsent": false,
  "entityMap": {
    "actual-dealersocket-kia-entity": "cranbourne_kia"
  }
}
```

An empty source list admits all newly forwarded sources. Strict consent holds leads without an explicit consent basis. Changing consent does not remove a suppression or restart a stopped journey. Intake accepts `leadType`, `isNewLead`, `enquiryConsent`, `marketingConsent`, `consentEvidence` and `receivedAt`; explicit enquiry consent requires evidence. Historical replays flagged `isNewLead: false` are rejected.

Optional `cutoverAt` establishes a forward-only enrolment boundary. First-step candidates received before that boundary, or more than seven days ago, are held with a review task instead of sending to an aged lead. Confirm the cutover policy before enabling the scheduler on existing data.

Journey steps contain `name`, `template`, `delayType`, `delayValue` and optional `requiresMarketingConsent`. Delay types are `immediate`, `business_hours`, `next_morning`, `calendar_days`. The first step must be immediate. Calendar days are anchored to lead receipt (default Day 3 is offset 2, Day 7 is offset 6). Closed days and Melbourne daylight saving are respected. Versions are pinned once a journey starts; published changes do not rewrite previous messages. Unknown/unpublished lead types and disabled enrolments are held for review.

## Workflow fixes

- After-hours leads get an actual next-open schedule; scheduler checks every 15 seconds. Legacy unscheduled active step-zero leads are also evaluated.
- Shared MongoDB leases serialize intake, staff/automated sends and journey mutations. Opportunity aliases preserve matching after same-mobile duplicate merge. Duplicate notifications and close-loop tasks are persistent.
- Incoming messages match normalized mobile plus the exact receiving rooftop, without cross-rooftop fallback or a lead-created-within-30-days restriction.
- Carrier message IDs deduplicate replies. SMS delivery receipts match carrier SID or internal event ID and do not regress terminal delivery states to pending.
- STOP adds global suppression, stops matching journeys at all three rooftops and queues opt-out write-back. One confirmation is attempted per suppression cycle through the carrier; failures remain recorded. Removing suppression does not resume opted-out prospects.
- Automated/staff SMS and replies queue CRM activity with message text, timestamp and thread link. Published version/actor metadata is stored on outbound events.
- CRM retries run every 30 seconds with exponential backoff, up to eight automatic attempts; a first failure flags the thread. Same-opportunity writes are ordered; later entries remain pending behind unresolved earlier failures. Manual retry is available. Retry-safe delivery still depends on partner support for the supplied idempotency key.
- Without verified CRM configuration, entries remain `pending` with `simulated: true`; simulation is not reported as actual CRM success.

## Required live environment setup

These are configuration names, not credentials; no existing `.env` was modified.

| Variable | Purpose |
| --- | --- |
| `LEAD_FORWARD_SECRET` | Shared secret required in `x-lead-forward-token` for both intake endpoints |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Real carrier credentials |
| `WEBHOOK_PUBLIC_BASE_URL` | Exact externally visible origin (for example the HTTPS backend domain) used for Twilio signature verification |
| `TWILIO_STATUS_CALLBACK_URL` | Public `/api/sms/delivery-receipt` callback URL |
| `WEBHOOK_TEST_TOKEN` | Optional development-only `x-webhook-test-token` for Swagger normalized webhook requests; disabled in production |
| `PORTAL_PUBLIC_URL` | Real frontend origin used in CRM thread links |
| `DS_API_BASE_URL`, `DS_CLIENT_ID`, `DS_CLIENT_SECRET` | Approved DealerSocket partner endpoint/credentials |
| `DS_ACTIVITY_PATH` | Partner-confirmed activity route with optional `{opportunityId}` placeholder |
| `DS_ASSIGNMENT_PATH` | Partner-confirmed reassignment route; explicit reassignment uses PATCH, not merely a work note |
| `JWT_SECRET` | Production requires at least 32 characters |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` | First production administrator; password must have at least 12 characters |

Native Twilio form payloads are accepted: `From`, `To`, `Body`, `MessageSid`, `NumMedia`, `MediaUrlN`; callbacks accept `MessageSid`, `MessageStatus`, `ErrorCode`, `ErrorMessage`. Signature verification uses the original form body. Native inbound responses return empty TwiML. Unknown receiving numbers are rejected. Webhook authentication is fail-closed if configuration is absent. JWT is not a replacement for carrier signature verification.

DealerSocket's actual authentication, activity schema and assignment schema are discovery-gated. The included configurable adapter sends a structured SMS activity (`type`, `action`, `note`, `timestamp`) and assignment (`assignedTo`). **These request schemas must be confirmed against the approved partner contract before live enablement; changing the URL alone does not prove compatibility.** No live DealerSocket or SMS requests were made during implementation.

## Retention and launch boundaries

Retention defaults to 24 months, with deletion disabled until the record policy is approved. Enabling `retentionEnabled` authorizes the daily 03:00 Melbourne cleanup of expired completed/stopped prospects, thread messages, CRM payload logs and associated work items. Preview first and maintain backups. Active journeys are excluded. Global suppressions and their administrative history are preserved so expiry does not silently resubscribe customers.

Shared leases protect normal concurrent requests, but do not promise exactly-once SMS delivery through a process crash between carrier acceptance and database persistence. Load/failure-recovery verification and the five-business-day live pilot remain required for launch.

Australia hosting/carrier residency, encrypted database storage/backups, TLS, registered/provisioned numbers, approved lead-forward source/entity maps and five-day acceptance are external deployment/client tasks. This code does not certify legal compliance or partner integration.

## Verification

Run `npm run build` and `node scripts/check-scope.cjs` for compile and offline calendar, DTO, footer, scope and Swagger-registration checks. The offline script never connects to MongoDB or calls live APIs. Existing conversation E2E isolation now also initializes and clears `portal_records`, but the suite was not rerun against a database and is not evidence of live validation for these new features.
