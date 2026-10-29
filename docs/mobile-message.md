# Mobile Message SMS integration

Twilio has been removed from the runtime and dependencies. Staff messages and journey messages use the same Mobile Message adapter. The existing conversation portal reads their thread events; no frontend provider credentials are needed.

## Server configuration

Keep `MOBILEMESSAGE_ENABLED=false` until provisioning and acceptance testing are complete. Missing credentials or disabled sending produces a failed event, never a simulated delivery.

Configure the backend secret manager or `.env`:

```dotenv
MOBILEMESSAGE_ENABLED=false
MOBILEMESSAGE_API_USERNAME=
MOBILEMESSAGE_API_PASSWORD=
MOBILEMESSAGE_WEBHOOK_SECRET=
SMS_KIA_NUMBER=
SMS_MG_NUMBER=
SMS_GEELY_NUMBER=
```

Use three distinct Mobile Message dedicated numbers that receive replies: Cranbourne Kia, Cranbourne MG and Geely Cranbourne. A personal mobile or alphanumeric sender does not forward replies into this portal. Existing saved rooftop settings override environment defaults: update the three sender numbers in rooftop settings if those records already exist. The former example numbers are not evidence of provisioning.

In Mobile Message Settings > API, configure:

- Inbound URL: `https://YOUR_BACKEND/api/sms/inbound`
- Message status URL: `https://YOUR_BACKEND/api/sms/delivery-receipt`
- Generate a signing secret and put the same value in `MOBILEMESSAGE_WEBHOOK_SECRET`.

The reverse proxy must preserve the exact JSON request body and `X-MM-Timestamp` / `X-MM-Signature` headers. The backend verifies HMAC-SHA256 over timestamp + `.` + raw bytes, compares in constant time and rejects timestamps outside five minutes. Keep the server clock synchronized. `WEBHOOK_TEST_TOKEN` only permits an explicit development test bypass; it never works in production.

Run the backend as a managed service with automatic restart. MongoDB stores both queues; no extra Windows connector process is required for SMS. DealerSocket scraping still needs its own connector and valid session.

## Message flow

For an initial one-way handset test, set `MOBILEMESSAGE_ENABLED=true` and `MOBILEMESSAGE_TEST_RECIPIENT` to the test handset. With this variable present, journey execution and automated outbox sending are paused; staff sends are allowed only to the exact test recipient and Cranbourne Kia, using `SMS_KIA_NUMBER` as the test sender. Other customers are rejected, never silently redirected. The provider adapter independently enforces the recipient restriction on retry. Restart the backend after changing `.env`. Select a Kia test prospect with that mobile in Portal conversations and send through SMS reply. Do not edit a real customer's number to perform a test. Without webhooks, provider acceptance stays pending until delivery can be verified separately. Production still requires webhook signing configuration; one-way testing does not bypass that requirement. Remove the test-recipient setting only after the full account and rooftop setup is ready, since that permits normal journeys to execute again.

Outbound: consent/suppression checks → save pending thread event and durable outbox → Mobile Message → save provider ID → signed delivery reports → update thread. Provider acceptance is pending, never delivered. The API uses Basic authentication, a stable `Idempotency-Key` and `custom_ref` for each outgoing event. Logs do not include provider credentials or SMS content.

Network failures, HTTP 409/429 and server errors retain the identical body/key and retry with backoff. Automated retries respect Melbourne sending hours, consent and staff takeover. Known rejections fail visibly. A previous message awaiting acceptance/reconciliation blocks another send for that prospect. Automated steps have deterministic event references, so a scheduler restart reuses the same outbox. Retries stop after 23 hours to stay inside the provider's 24-hour idempotency retention: check provider history against `custom_ref` before any manual resend.

Inbound/status webhooks are validated and inserted into a durable inbox before HTTP 200. A five-second worker applies them. Duplicate payloads are ignored. Because inbound webhooks do not supply a unique incoming ID, deduplication hashes the canonical payload, including provider timestamp. Two genuinely identical messages from the same sender in the same second cannot be distinguished by this contract.

Replies route using the original outgoing reference and validated mobile/rooftop; absent correlation requires exactly one matching prospect. Ambiguous or unknown routes remain in the inbox for review. Replies pause journeys, update the ordered thread and notify staff. `received_at` is interpreted as UTC.

Delivery reports validate both numbers and message identity. Reports may arrive before the outgoing provider ID is saved; they remain queued and correlate by `custom_ref`. Multipart messages are delivered only when all parts are delivered; any failed part fails the message. Repeated/stale `sent` callbacks cannot overwrite terminal part states.

STOP/unsubscribe events suppress the mobile across all three rooftops, including when routing is unknown. **Configure and verify a single provider-side opt-out confirmation rule before launch if the scope requires a confirmation SMS.** This application does not bypass Mobile Message's unsubscribe filtering or claim that a confirmation was delivered. An `optout_confirmation` record records provider handoff only. Confirm the account's existing rules so the customer does not receive duplicate confirmations.

## Monitoring and acceptance

Group admins can read `GET /api/sms/status` with their normal bearer token. It reports configuration flags and pending/failed/review queue items without returning API credentials. Investigate `review` items against provider history and the thread; there is intentionally no blind resend endpoint. Queue data is in `portal_records`, kinds `sms_outbox` and `sms_inbox`. These records contain personal message data: apply the approved access and retention policy to this collection too.

Tests use mocked HTTP and an in-memory store, including real local HTTP requests for raw-body signature verification:

```powershell
npx jest --config ./test/jest-e2e.json --runInBand mobile-message.e2e-spec.ts
npm run build
```

Before enabling production sending, use provider sandbox credentials to verify each rooftop's outbound acceptance, inbound routing, two-part receipt, failed receipt, invalid signature, STOP suppression and confirmation configuration. Then carry out an explicitly authorized live handset test. No SMS is sent by the automated tests.

DealerSocket lead scraping remains read-only and does not enroll scraped records into SMS journeys. SMS events still use the existing CRM writeback queue, but actual CRM writes require `DEALERSOCKET_WRITEBACK_ENABLED=true` and the separately verified partner credentials/routes. Mobile Message configuration does not enable CRM writes.

Provider contracts: [API schema](https://mobilemessage.com.au/assets/openapi.json), [signature verification](https://help.mobilemessage.com.au/api/verifying-webhook-signatures), [two-way SMS](https://help.mobilemessage.com.au/sending-receiving-sms/two-way-sms-basics-how-replies-work), [opt-out rules](https://help.mobilemessage.com.au/sending-receiving-sms/inbound-automations).
