SCOPE OF WORK

Matador replacement

New-lead SMS journeys and conversation portal

Cranbourne MG, Cranbourne Kia and Geely Cranbourne  ·  DealerSocket

| Field | Detail |
| --- | --- |
| Document | Scope of work — Matador replacement, new-lead SMS journey and conversation portal |
| Prepared for | Booran Motor Group — Cranbourne MG, Cranbourne Kia, Geely Cranbourne |
| Prepared by | OmniSuiteAI Pty Ltd  ·  ABN 39 626 001 081 |
| Date | 9 October 2026 |
| Status | Draft for client review — not a contract |
| Rooftops in scope | Cranbourne Kia (209 South Gippsland Hwy), Cranbourne MG (215), Geely Cranbourne (217A) |
| CRM | DealerSocket (Solera). New leads already landing in DealerSocket are the trigger. |
| Replaces | Matador as the SMS engagement layer for new leads at these three rooftops |

## 1. Purpose

This scope defines the replacement of Matador for new leads that land in DealerSocket at the three Cranbourne rooftops. The replacement does two things, as one system.

When a new lead is dropped into DealerSocket, an automated SMS journey starts without a salesperson having to open the record.

Sales and BDC users log into a portal, open that prospect, and see one conversation thread — platform to customer and customer to platform — in time order. Their own SMS sends from the portal join that same thread, in sequence, not in a side channel.

DealerSocket remains the system of record for the opportunity. The portal is the system of record for the SMS conversation. Activity writes back so the CRM history is not a second, incomplete story.

## 2. Background

Matador is the current SMS engagement layer on DealerSocket. In the Australian pattern, new DealerSocket leads are forwarded to Matador, an automated SMS conversation starts, and messages are written back to the opportunity. Staff can also text from inside DealerSocket. That is the behaviour this scope replaces, limited to new leads at the three Cranbourne stores.

The three rooftops sit together on South Gippsland Highway, Cranbourne, under Booran Motor Group (LMCT 11602): Cranbourne Kia at 209, Cranbourne MG at 215, and Geely Cranbourne at 217A. They are treated as three dealership identities on one platform, not one blended inbox.

|  | Boundary<br>This engagement covers new leads only. Service reminders, database broadcasts, aged-lead blasts and equity campaigns are out of scope unless added by change request. The portal must still show the full thread for any prospect the new-lead journey has touched. |
| --- | --- |

## 3. Objectives

Start a compliant SMS journey within 60 seconds of a qualifying new lead landing in DealerSocket.

Keep one ordered thread per prospect: automated outbound, staff outbound and customer inbound, in the sequence they actually occurred.

Let an authorised user send their own SMS from the portal and have it appear in that thread immediately, and pause or resume the automated journey against the same record.

Separate MG, Kia and Geely so a user sees only the rooftops they are entitled to, on the correct sender identity.

Write the conversation and key outcomes back to the DealerSocket opportunity so managers are not working two systems to know what was said.

Honour Australian Spam Act and ACMA sender-ID rules on every commercial message, including a working unsubscribe.

## 4. In scope and out of scope

### 4.1 In scope

| Area | Included |
| --- | --- |
| Lead intake | New leads dropped into DealerSocket for the three Cranbourne rooftops, all current internet and third-party sources that already create a DealerSocket opportunity. |
| Journey | Configurable automated SMS sequence per rooftop and lead type. Stop, pause and handoff rules. Business-hours and quiet-hours control. |
| Portal | Authenticated web portal: prospect list, filters, and a single chronological thread per prospect. |
| Staff SMS | Compose and send from the portal on the rooftop number. Message joins the thread in order. Templates. Internal notes that the customer never sees. |
| Two-way | Inbound customer replies land on the same thread, in order, and are visible to every user entitled to that prospect. |
| CRM write-back | Lead match, activity or work-note write-back, status markers for engaged, opted out, appointment requested and handed to sales. |
| Identity | One sending identity per rooftop (MG, Kia, Geely), with brand name in the message body. |
| Compliance | Consent check, identification, unsubscribe keyword, suppression list, send audit. |
| Admin | Users, roles, rooftop access, journey editor, template library, business hours, quiet hours. |

### 4.2 Out of scope

Replacement of DealerSocket itself, desking, inventory or the DMS.

Voice, email sequences, web chat and social DM, unless added later.

Database broadcast and aged-lead campaigns. New leads only.

A DealerSocket browser extension. Staff work the thread in the portal. CRM write-back keeps DealerSocket current.

Migration of historical Matador threads. Cutover is forward-looking from an agreed go-live date. A one-off export of open Matador conversations can be quoted separately if required for continuity.

AI free-form reply as a default. Phase 1 is a controlled journey plus human send. An AI reply agent is specified as an optional phase, not a launch dependency.

## 5. How it works

The operating loop is one path, not two products bolted together.

| Step | What happens |
| --- | --- |
| 1. Lead drops | A new lead creates or updates an opportunity in DealerSocket for Cranbourne MG, Kia or Geely. |
| 2. Forward | DealerSocket Lead Forwarding (XML or ADF email, to be confirmed at discovery) posts the lead to the platform within seconds. |
| 3. Match | Platform matches on DealerSocket entity or opportunity id, mobile and rooftop. Duplicate leads on the same mobile inside a configurable window join the existing thread rather than starting a second journey. |
| 4. Journey starts | If the mobile is valid, not suppressed, and consent rules pass, the first message sends and the thread is created. |
| 5. Customer replies | Inbound SMS appends to that thread in received order and can branch or pause the journey. |
| 6. Staff engage | A user opens the prospect, reads the full thread, and sends. That send is the next item in the same sequence and pauses automation until released. |
| 7. Write-back | Each outbound, inbound and outcome is posted to the DealerSocket opportunity as an activity or work note, with a link back to the thread. |

A prospect has exactly one thread. Automated messages, staff messages and customer messages are events on that thread, ordered by sent or received time. There is no separate “automation log” and “staff inbox”.

## 6. Lead intake

### 6.1 Trigger

The trigger is a new lead dropped into DealerSocket for one of the three rooftop entities. “New” means a lead that DealerSocket has just created or reopened as a workable sales opportunity, not a historical record replayed on cutover.

### 6.2 Minimum payload

DealerSocket customer and opportunity identifiers, stable enough to write activity back.

Rooftop or dealer entity, mapped to MG, Kia or Geely.

Customer name, mobile, email, lead source, vehicle of interest, comments, salesperson if already assigned.

Lead received timestamp from DealerSocket.

### 6.3 Matching and duplicates

Primary key is the DealerSocket opportunity id. Secondary match is normalised Australian mobile plus rooftop.

A second lead on the same mobile and rooftop inside 14 days (configurable) does not start a parallel journey. It appends a system event to the open thread and notifies the owner.

The same mobile at a different rooftop is a separate thread and a separate sender identity. Cross-rooftop visibility is a manager permission, not the default.

Invalid, landline and suppressed numbers are logged, not sent, and written back as a failed-contact activity.

## 7. Automated journey

### 7.1 Default new-lead journey

Each rooftop can run its own copy. The default below is the starting configuration for a new-vehicle internet lead, to be signed off in workshop. Timing respects quiet hours (no send before 9:00 or after 20:00 AEST/AEDT, and not on the dealership’s closed days, unless a customer reply arrives and a human chooses to respond).

| Step | When | Intent | Stop if |
| --- | --- | --- | --- |
| 1. Ack | Within 60 seconds of a qualifying lead | Identify the rooftop, confirm the enquiry, ask one qualifying question. | Invalid number, suppression, outside consent rule. |
| 2. Qualify | If no reply, +4 business hours | Timeframe, model or stock, new or used. | Reply received, opted out, human takeover. |
| 3. Book | If no reply, next business morning | Offer a test drive or call window. | Appointment flagged, opted out, takeover. |
| 4. Nudge | Day 3 if still open | Short reminder, same vehicle of interest. | Closed, opted out, takeover. |
| 5. Close loop | Day 7 if still open | Final automated touch. Hand back to the assigned salesperson as a task. | Any prior stop. |

### 7.2 Behaviour rules

A customer reply pauses the automated sequence and raises the thread in the portal. Automation does not talk over a live human exchange.

A staff send from the portal also pauses the sequence. The user can resume, skip to a later step, or close the journey.

STOP, STOPALL, UNSUBSCRIBE, CANCEL, END and QUIT suppress the number immediately, confirm once, and write the opt-out back to DealerSocket.

Appointment, not interested, already bought, and wrong number are explicit outcomes. Each ends the journey and sets the portal status.

Merge fields: first name, rooftop, brand, vehicle of interest, salesperson first name, dealership phone. Missing vehicle falls back to a generic line, never a blank token.

Journey copy is versioned. A change does not rewrite messages already sent.

### 7.3 Optional phase — AI reply

Not required to launch. If taken, an AI reply agent answers inside the same thread, using the rooftop’s approved knowledge (models, hours, stock hooks) and the same stop rules. Staff can take over at any message. AI sends are labelled in the portal so a manager can see who — or what — sent each line. This phase is scoped separately and does not block Phase 1 acceptance.

## 8. Conversation portal

### 8.1 Access

Users sign in with email and password, with optional SSO if Booran’s identity provider is available. Sessions expire. A user is bound to one or more rooftops. A salesperson sees their own prospects plus unassigned in their rooftop. A BDC or sales manager sees the rooftop. A group admin sees all three.

### 8.2 Prospect list

Columns: customer, mobile, rooftop, source, vehicle, owner, journey step, last message direction, last activity time, status.

Filters: rooftop, owner, mine / unassigned, status (new, in journey, waiting on us, waiting on customer, opted out, closed), source, date landed.

Default sort is last inbound first, so a reply is never buried under automated sends.

Unread inbound is badged. Assignment can be changed from the list or the thread.

### 8.3 Thread

The thread is the product. Opening a prospect shows every event in order, oldest at the top, newest at the bottom, with a composer pinned under the latest message.

| Event type | How it appears | Customer sees it? |
| --- | --- | --- |
| Automated outbound | Left or outbound lane, labelled with the journey step name and sent time. | Yes |
| Staff outbound | Same outbound lane, labelled with the user’s name and sent time. Sits after whatever preceded it. | Yes |
| Customer inbound | Inbound lane, received time, full body including media if the carrier passes it. | Originator |
| System | Opt-out, journey paused, lead merged, write-back failed. Compact, not mixed into the SMS copy. | No |
| Internal note | Distinct note style. Never sent, never exported to the customer. | No |

Order is strict. A staff message sent at 10:04 sits between the 10:01 automated message and the 10:06 customer reply. Refresh and a second user opening the same prospect see the same order. There is no “staff thread” beside the journey thread.

### 8.4 Sending

Composer sends on the rooftop’s number, not a personal mobile. The message is appended to the thread on accept by the carrier, with a pending then delivered or failed state.

Character count, segment count and a template picker sit on the composer. Sending pauses the journey and records the user.

Failed sends stay in the thread as failed, with the reason, and can be retried. They are not silently dropped.

Users cannot edit or delete a sent message. They can add an internal note.

### 8.5 What the portal is not

It is not a second CRM. It does not desk a deal, hold stock, or replace the DealerSocket opportunity screen. It is the place the conversation lives, and the place a user answers.

## 9. Roles

| Role | Sees | Can |
| --- | --- | --- |
| Salesperson | Own and unassigned prospects at their rooftop. | Read thread, send SMS, add notes, set outcome, resume or stop journey. |
| BDC | All prospects at assigned rooftops. | Same as salesperson, plus reassign and work the unassigned queue. |
| Sales manager | Their rooftop, all owners. | Same as BDC, plus journey performance for that rooftop. |
| Group admin | MG, Kia and Geely. | Users, rooftop access, journey and template edit, suppression list, audit export. |
| Read only | As granted. | Open threads. Cannot send. |

## 10. DealerSocket write-back

Write-back uses DealerSocket inbound activity or work-note update against the opportunity id captured at intake. Exact method is confirmed at discovery, because DealerSocket partner access is certification-gated and not self-serve.

First outbound: activity noting journey started, with the message body.

Each subsequent outbound and inbound: appended note or activity, timestamped, so the CRM transcript matches the portal order.

Outcomes: opted out, appointment requested, not interested, wrong number, handed to salesperson. These set a portal status and a CRM activity the store already knows how to filter.

Write-back failure does not block the SMS. It flags the thread and retries. A daily exception list is visible to the admin.

DealerSocket remains authoritative for customer and opportunity fields. The portal does not overwrite name, source or salesperson assignment unless a user explicitly reassigns inside the portal, in which case the change is sent back as an update.

## 11. Compliance

Commercial SMS to these leads is covered by the Spam Act 2003 and ACMA rules. The platform enforces the three obligations on every automated and staff send.

Consent. A new-lead enquiry is treated as consent to respond about that enquiry. Ongoing promotional steps after the enquiry is resolved require a recorded consent flag. The journey stops at the close-loop step rather than rolling into a newsletter.

Identification. Every message names the rooftop (Cranbourne Kia, Cranbourne MG or Geely Cranbourne) and a contact path. Sender ID is a registered alpha tag or dedicated mobile, per the ACMA sender-ID register.

Unsubscribe. Every commercial message carries a working opt-out (reply STOP). Opt-out is free, does not require a login, and is actioned immediately in the platform and within five business days at the latest in any downstream list. The keyword keeps working for at least 30 days after send.

Quiet hours and a suppression list shared across the three rooftops for a given mobile, so an opt-out at Kia is not ignored by MG.

Privacy Act. Message content, mobile numbers and lead payloads are stored in Australia where the carrier and host allow it. Access is role-bound. Retention follows Booran’s customer-record policy, default 24 months from last activity unless instructed otherwise.

Audit. Who sent, what was sent, when, and from which journey version, exportable for a complaint or ACMA query.

## 12. Non-functional

| Item | Target |
| --- | --- |
| First message | Within 60 seconds of a qualifying lead forward, inside send hours. |
| Inbound to portal | Visible in the thread within 10 seconds of carrier delivery. |
| Availability | Portal and inbound path 99.5% in dealership hours, excluding planned windows. |
| Concurrency | Sized for three rooftops and a normal internet-lead day, with headroom for a campaign spike on the websites. |
| Browsers | Current Chrome, Edge and Safari. Desktop first. A usable phone layout for the thread and composer. |
| Security | TLS, hashed passwords or SSO, role checks on every thread read and send, encryption at rest for message bodies and mobiles. |
| Tenancy | One Booran tenant, three rooftop partitions. No cross-client data. |

## 13. Delivery

### 13.1 Phases

| Phase | Outcome | Depends on |
| --- | --- | --- |
| 0. Discovery | Lead-forward sample, entity map for the three rooftops, sender-ID decision, journey copy sign-off, role list. | DealerSocket admin and current Matador/Delos contact. |
| 1. Intake and journey | Leads forward, match, first journey sends, opt-out works, write-back of send and reply. | DealerSocket forwarding credentials or ADF mailbox. |
| 2. Portal | Login, list, ordered thread, staff send into that thread, pause and resume, notes. | Phase 1 thread store. |
| 3. Pilot | One rooftop, live new leads, Matador still on for the other two. Five business days of parallel watch. | Store champion and a daily exception review. |
| 4. Cutover | All three rooftops. Matador new-lead path switched off. Forward only; no history migration. | Pilot acceptance. |
| Optional | AI reply inside the same thread, labelled, with takeover. | Phase 4 stable. |

### 13.2 Indicative effort

Discovery is a short fixed piece. Build is quoted after the DealerSocket forward path is confirmed, because partner certification — or an ADF email forward that already exists for Matador — changes the integration effort more than the portal does. Commercial structure is a build fee plus a month-to-month platform fee covering numbers, carrier, hosting and support. Figures are not in this draft.

### 13.3 Client responsibilities

DealerSocket admin access and approval to add a lead-forward destination, or to repoint the existing Matador forward.

Confirmation of which lead sources count as “new leads” for each rooftop.

Registered sender IDs or approval to provision dedicated mobiles in the rooftop names.

Journey copy and quiet hours signed off before pilot.

A named store champion for the pilot rooftop, and a cutover date agreed with the incumbent.

## 14. Acceptance

Phase 4 is accepted when all of the following hold on live new leads across the three rooftops for five consecutive business days.

A qualifying new lead in DealerSocket creates one thread and sends step 1 inside 60 seconds during send hours.

A second lead on the same mobile and rooftop inside the duplicate window does not start a second journey.

A customer reply appears on that thread in order, and pauses the journey.

A staff SMS sent from the portal appears on that same thread after the events that preceded it and before events that follow, and is delivered from the rooftop identity.

Two users opening the prospect see the same order.

STOP suppresses further automated and staff sends to that mobile across all three rooftops, with one confirmation.

DealerSocket shows the matching activity or work notes for sends, replies and the opt-out.

A user without rooftop access cannot open the thread.

## 15. Assumptions and risks

| Item | Treatment |
| --- | --- |
| DealerSocket forwarding is available | Assumed, because Matador already receives these leads. If the current path is locked to the incumbent, OmniSuiteAI will need a new forward destination approved by the dealer and, if required, Solera. |
| Matador contract allows exit on new leads | Client confirms notice period and whether numbers can be ported. Cutover date sits after that notice. |
| Numbers | Prefer porting the numbers customers already have, so in-flight replies are not lost. If porting is refused, new numbers are provisioned and the first message says so. |
| Consent model | Enquiry response is in scope. A broader marketing consent flag is not assumed to exist in DealerSocket. |
| After-hours leads | Queued to 9:00 local, not sent at 2:00. Configurable. |
| Write-back shape | Activity or work note, not a promise to render inside a Matador-style browser extension. |

## 16. Open points for workshop

Which DealerSocket entities map to Cranbourne Kia, Cranbourne MG and Geely Cranbourne, and who administers the lead forward today.

Whether the incumbent forward can be repointed, or a second destination added, without a Solera certification cycle.

Sender ID: alpha tag per brand, or a dedicated mobile per rooftop, and whether the current Matador numbers can be ported.

Lead sources in: carsales, website, Facebook, OEM, walk-in logged as a lead, phone-up. Confirm the list that should start a journey.

Who owns the unassigned queue overnight and on Saturday.

Whether historical open Matador threads must be visible on day one, or whether cutover is forward-only.

Whether the optional AI reply phase is in the first commercial conversation or parked.

## 17. Document status

This is a delivery scope for review. It becomes the basis of a statement of work once the open points in section 16 are answered and the DealerSocket forward path is confirmed. It is not an offer to vary any incumbent contract, and it does not transfer DealerSocket or Matador intellectual property.

OmniSuiteAI Pty Ltd  ·  10 Merna Drive, Templestowe VIC 3106  ·  info@omnisuiteai.com  ·  www.omnisuiteai.com
