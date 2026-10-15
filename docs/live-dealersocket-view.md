# Live DealerSocket frontend view

The prospect workspace now defaults to **Live DealerSocket leads**. It reads the Python connector's latest snapshots through Nest and the Next proxy. The last completed snapshot is privately persisted by the connector and restored after restart. **Portal conversations** retains the existing MongoDB-backed conversation list. A scraped opportunity is not converted into a conversation or automatically enrolled in a journey by this integration.

## Use

Keep the Windows Python connector running with its saved Chrome session and configured matching private key. Restart the backend and frontend after updating them. In the portal open **Prospect list → Live DealerSocket leads**.

The lead screen has no manual fetch button. The admin-only refresh API remains available for maintenance; requests queue one read immediately and return 202. The screen polls job status every five seconds. With `DEALERSOCKET_LEAD_SYNC_ENABLED=true`, the Python connector schedules hourly reads independently of the frontend and displays the interval/next attempt on screen. Busy operations skip an hourly attempt. Retained rows remain scoped by rooftop/owner during running/failed reads and keep their original observation time. See the Python project's `docs/dealersocket-server-deployment.md` and `deploy/dealersocket-connector.service` for server setup. When server sync is disabled, the optional browser auto-refresh control is available. Do not run a separate watch worker alongside the enabled server scheduler.

Each frontend request reads up to 1,000 records and 200 fresh details. A larger dataset, incomplete details or missing rooftop observations remain partial, not silently complete. The UI shows source/owner/status/contact data, last snapshot time, read duration, details-versus-queue-only labels, source timestamps and missing-field warnings. Search and rooftop/owner filters apply to the authorized snapshot. Geely with no observed records is explicitly unverified, not proof that its CRM has no leads.

These are snapshots of selected accessible queues, not guaranteed complete CRM coverage or proof that the records are newly created/reopened. Source creation timestamps are preserved without claiming they are lead-received timestamps.

## APIs and permissions

- `GET /api/integrations/dealersocket/leads/status`: authenticated scoped viewer roles.
- `POST /api/integrations/dealersocket/leads/read`: Group Admin only, fixed read limits.

The existing controller's Group Admin default remains for session status/check/login actions. The live snapshot GET has an explicit viewer-role override. Managers/BDC/read-only users see only assigned rooftops. Salespeople additionally see only explicit own-name or unassigned records; missing assignment evidence does not grant access. DealerSocket employee IDs are not assumed to equal portal user IDs. The Group Admin summary can show connector candidate totals; other viewers receive only scoped record counts and no global candidate totals or cross-rooftop queue/review details.

Nest whitelists row identity/contact/source fields and computes visible counts after authorization. Unknown rooftops/invalid record identities reject the response. Raw connector records, cookies, storage, tokens, arbitrary failure bodies and unscoped detail errors are not forwarded. The Next proxy independently whitelists the public response, verifies portal authentication and requires same-origin requests for refresh. Connector keys stay server-side.

The bridge makes no prospect/message/suppression/journey writes. Refresh actions record an administrative audit entry only. It does not call the lead ingestion endpoint, Twilio or the DealerSocket write-back adapter. Existing dashboard/conversation data still comes from MongoDB.

## Verification

Backend `test/dealersocket-session.e2e-spec.ts` covers access control, ownership, empty rooftop grants, metadata isolation, malformed responses, fixed read limits and contention. Frontend `tests/dealersocket.test.mjs` covers proxy authentication/CSRF, refresh permissions and response whitelisting. `tests/browser-dealersocket.mjs` exercises built UI refresh/search/rooftop filters, read-only viewer controls and desktop/mobile layout using synthetic API responses.

The live verification uses the configured connector against actual DealerSocket queues and the compiled Nest response sanitizer, without starting the full application's scheduler or mutating its customer database. This complements the isolated HTTP tests; it does not represent full deployed-login/production acceptance.
