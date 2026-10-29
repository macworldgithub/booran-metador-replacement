import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request = require('supertest');
import { createHmac } from 'crypto';
import axios from 'axios';
import { SmsController } from '../src/modules/sms/sms.controller';
import { SmsService } from '../src/modules/sms/sms.service';
import {
  MobileMessageService,
  MobileMessageError,
} from '../src/modules/sms/mobile-message.service';
import { WebhookGuard } from '../src/modules/auth/guards/webhook.guard';
import { ThreadEventType, RooftopId } from '../src/common/enums';
import { JourneyService } from '../src/modules/journey/journey.service';

describe('Mobile Message (isolated mocks; no live SMS or database)', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.MOBILEMESSAGE_TEST_RECIPIENT;
  });
  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...saved };
  });

  it('fails closed when sending is disabled or credentials are missing', async () => {
    delete process.env.MOBILEMESSAGE_ENABLED;
    const post = jest.spyOn(axios, 'post');
    const provider = new MobileMessageService();
    await expect(provider.send({}, 'key')).rejects.toThrow('disabled');
    process.env.MOBILEMESSAGE_ENABLED = 'true';
    delete process.env.MOBILEMESSAGE_API_USERNAME;
    await expect(provider.send({}, 'key')).rejects.toThrow('credentials');
    expect(post).not.toHaveBeenCalled();
  });

  function enable() {
    process.env.MOBILEMESSAGE_ENABLED = 'true';
    process.env.MOBILEMESSAGE_API_USERNAME = 'mock-only';
    process.env.MOBILEMESSAGE_API_PASSWORD = 'mock-only';
  }

  it('restricts one-way tests to one recipient without rewriting another customer number', async () => {
    enable();
    process.env.MOBILEMESSAGE_TEST_RECIPIENT = '+61499918523';
    const post = jest
      .spyOn(axios, 'post')
      .mockResolvedValue({
        data: { results: [{ status: 'success', message_id: 'test-id' }] },
      });
    const provider = new MobileMessageService();
    await expect(
      provider.send({ messages: [{ to: '+61412345678' }] }, 'wrong'),
    ).rejects.toThrow('test recipient');
    expect(post).not.toHaveBeenCalled();
    await expect(
      provider.send({ messages: [{ to: '61499918523' }] }, 'right'),
    ).resolves.toBe('test-id');
  });

  it('pauses journey execution and rejects direct automated sends during one-way testing', async () => {
    process.env.MOBILEMESSAGE_TEST_RECIPIENT = '+61499918523';
    const f = fixture();
    const journeys = new JourneyService(f.store, f.sms);
    await expect(journeys.processDueProspect(f.prospect)).resolves.toBe(false);
    expect(f.store.findProspectById).not.toHaveBeenCalled();
    await expect(
      f.sms.sendOutboundSms({
        prospect: f.prospect,
        content: 'Do not send',
        type: ThreadEventType.AUTOMATED_OUTBOUND,
      }),
    ).rejects.toThrow('paused');
    expect(f.provider.send).not.toHaveBeenCalled();
  });

  it('uses the configured Kia test sender and blocks staff messages to other customers', async () => {
    process.env.MOBILEMESSAGE_TEST_RECIPIENT = '+61499918523';
    process.env.SMS_KIA_NUMBER = '+61411111112';
    const f = fixture();
    await expect(
      f.sms.sendOutboundSms({
        prospect: f.prospect,
        content: 'Wrong recipient',
        type: ThreadEventType.STAFF_OUTBOUND,
      }),
    ).rejects.toThrow('test recipient');
    f.prospect.normalizedMobile = '+61499918523';
    f.prospect.rooftopId = RooftopId.CRANBOURNE_KIA;
    await f.sms.sendOutboundSms({
      prospect: f.prospect,
      content: 'Handset test',
      type: ThreadEventType.STAFF_OUTBOUND,
    });
    expect(f.provider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            to: '+61499918523',
            sender: '+61411111112',
          }),
        ],
      }),
      expect.any(String),
    );
    expect(f.writeback.queueWriteback).not.toHaveBeenCalled();
  });

  it('requires webhook signing configuration before production sends', async () => {
    enable();
    process.env.NODE_ENV = 'production';
    delete process.env.MOBILEMESSAGE_WEBHOOK_SECRET;
    const post = jest.spyOn(axios, 'post');
    await expect(new MobileMessageService().send({}, 'stable')).rejects.toThrow(
      'webhook signing',
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('uses Basic auth and the stable idempotency key; checks individual results', async () => {
    enable();
    const post = jest.spyOn(axios, 'post').mockResolvedValueOnce({
      data: { results: [{ status: 'success', message_id: 'provider-1' }] },
    });
    const provider = new MobileMessageService();
    await expect(provider.send({ messages: [] }, 'stable')).resolves.toBe(
      'provider-1',
    );
    expect(post).toHaveBeenCalledWith(
      'https://api.mobilemessage.com.au/v1/messages',
      { messages: [] },
      expect.objectContaining({
        auth: { username: 'mock-only', password: 'mock-only' },
        headers: { 'Idempotency-Key': 'stable' },
        maxRedirects: 0,
      }),
    );
    post.mockResolvedValueOnce({ data: { results: [{ status: 'blocked' }] } });
    await expect(provider.send({}, 'blocked')).rejects.toMatchObject({
      retryable: false,
    });
    post.mockResolvedValueOnce({ data: {} });
    await expect(provider.send({}, 'unknown')).rejects.toMatchObject({
      retryable: true,
    });
  });

  it.each([401, 403, 422, 429, 409, 500, undefined])(
    'classifies provider error %s without leaking auth',
    async (status) => {
      enable();
      jest.spyOn(axios, 'post').mockRejectedValue({
        isAxiosError: true,
        response: status ? { status } : undefined,
      });
      await expect(
        new MobileMessageService().send({}, 'stable'),
      ).rejects.toMatchObject({
        retryable: !status || [409, 429, 500].includes(status),
      });
    },
  );

  function fixture() {
    const records = new Map<string, any>();
    const events = new Map<string, any>();
    const prospect: any = {
      id: 'prospect',
      rooftopId: 'kia',
      normalizedMobile: '+61412345678',
      journey: { status: 'active', currentStep: 0 },
      consent: { enquiryConsent: true },
      dealerSocketOpportunityId: 'opportunity',
    };
    const rooftop: any = {
      id: 'kia',
      name: 'Test Kia',
      senderPhone: '+61411111111',
      address: 'Test address',
      displayPhone: 'Test phone',
      sendHours: { start: '00:00', end: '23:59' },
      closedDays: [],
    };
    const store: any = {
      lease: jest.fn(async () => 'owner'),
      releaseLease: jest.fn(async () => {}),
      recordGet: async (kind: string, key: string) =>
        structuredClone(records.get(kind + key) ?? null),
      recordSave: async (kind: string, key: string, data: any) => {
        records.set(kind + key, structuredClone({ key, data }));
      },
      recordInsert: async (kind: string, key: string, data: any) => {
        if (!records.has(kind + key))
          records.set(kind + key, structuredClone({ key, data }));
      },
      recordList: async (kind: string, filter: any = {}) =>
        [...records.entries()]
          .filter(
            ([key, record]) =>
              key.startsWith(kind) &&
              Object.entries(filter).every(([path, value]: any) => {
                const actual = path
                  .split('.')
                  .reduce((o: any, k: string) => o?.[k], record);
                return value?.$in
                  ? value.$in.includes(actual)
                  : value?.$ne
                    ? actual !== value.$ne
                    : actual === value;
              }),
          )
          .map(([, record]) => structuredClone(record)),
      smsEvent: async (ref: string) =>
        structuredClone(
          events.get(ref) ??
            [...events.values()].find(
              (e) => e.metadata?.providerMessageId === ref,
            ) ??
            null,
        ),
      patchSmsEvent: jest.fn(async (id: string, patch: any) => {
        const event = events.get(id);
        for (const [path, value] of Object.entries(patch)) {
          if (path.startsWith('metadata.'))
            event.metadata[path.slice(9)] = value;
          else event[path] = value;
        }
      }),
      addEvent: jest.fn(async (event: any) => {
        events.set(event.id, structuredClone(event));
        return event;
      }),
      findProspectById: jest.fn(async () => prospect),
      getSettings: async () => ({}),
      refreshRooftops: async () => {},
      getRooftopById: () => rooftop,
      getRooftopBySenderPhone: (to: string) =>
        to === rooftop.senderPhone ? rooftop : null,
      isSuppressed: jest.fn(async () => false),
      updateProspect: jest.fn(async () => {}),
      unambiguousProspect: jest.fn(async () => prospect),
      claimCarrierMessage: jest.fn(async () => true),
      recordDelete: async () => {},
      notifyOwner: jest.fn(async () => {}),
      createTask: jest.fn(async () => {}),
      audit: async () => {},
    };
    const compliance: any = {
      isMobileSuppressed: async () => false,
      addSuppression: jest.fn(async () => {}),
    };
    const provider: any = { send: jest.fn(async () => 'provider-1') };
    const writeback: any = { queueWriteback: jest.fn(async () => {}) };
    const sms = new SmsService(store, compliance, writeback, provider);
    return {
      sms,
      store,
      records,
      events,
      prospect,
      rooftop,
      provider,
      compliance,
      writeback,
    };
  }

  it('persists before sending and reports acceptance as pending, not delivered', async () => {
    const f = fixture();
    f.provider.send.mockImplementation(async () => {
      expect(f.events.size).toBe(1);
      expect(
        [...f.records.keys()].some((k) => k.startsWith('sms_outbox')),
      ).toBe(true);
      return 'provider-1';
    });
    const event = await f.sms.sendOutboundSms({
      prospect: f.prospect,
      content: 'Hello',
      type: ThreadEventType.STAFF_OUTBOUND,
    });
    expect(event.deliveryStatus).toBe('pending');
    expect(event.metadata?.providerMessageId).toBe('provider-1');
    expect(f.store.updateProspect).toHaveBeenCalledWith(
      'prospect',
      expect.objectContaining({
        journey: expect.objectContaining({ status: 'paused' }),
      }),
    );
  });

  it('retries uncertain sends with the identical body/key after a worker restart', async () => {
    const f = fixture();
    f.provider.send.mockRejectedValueOnce(
      new MobileMessageError('Timeout', true),
    );
    const event = await f.sms.sendOutboundSms({
      prospect: f.prospect,
      content: 'Hello',
      type: ThreadEventType.STAFF_OUTBOUND,
    });
    const job = f.records.get('sms_outbox' + event.id);
    job.data.nextAttemptAt = 0;
    await f.sms.processSmsQueues();
    expect(f.provider.send).toHaveBeenCalledTimes(2);
    expect(f.provider.send.mock.calls[1]).toEqual(
      f.provider.send.mock.calls[0],
    );
    expect(f.records.get('sms_outbox' + event.id).data.state).toBe('accepted');
  });

  it('does not retry after the provider idempotency window', async () => {
    const f = fixture();
    f.provider.send.mockRejectedValueOnce(
      new MobileMessageError('Timeout', true),
    );
    const event = await f.sms.sendOutboundSms({
      prospect: f.prospect,
      content: 'Hello',
      type: ThreadEventType.STAFF_OUTBOUND,
    });
    const job = f.records.get('sms_outbox' + event.id);
    job.data.nextAttemptAt = 0;
    job.data.createdAt = Date.now() - 24 * 3600_000;
    await f.sms.processSmsQueues();
    expect(f.provider.send).toHaveBeenCalledTimes(1);
    expect(f.records.get('sms_outbox' + event.id).data.state).toBe('review');
  });

  it('rechecks consent before retrying an uncertain send', async () => {
    const f = fixture();
    f.provider.send.mockRejectedValueOnce(
      new MobileMessageError('Timeout', true),
    );
    const event = await f.sms.sendOutboundSms({
      prospect: f.prospect,
      content: 'Hello',
      type: ThreadEventType.STAFF_OUTBOUND,
    });
    f.records.get('sms_outbox' + event.id).data.nextAttemptAt = 0;
    f.prospect.consent.enquiryConsent = false;
    await f.sms.processSmsQueues();
    expect(f.provider.send).toHaveBeenCalledTimes(1);
    expect(f.records.get('sms_outbox' + event.id).data.state).toBe('review');
  });

  it('recovers a crash after carrier acceptance but before saving its provider ID', async () => {
    const f = fixture();
    f.store.patchSmsEvent.mockRejectedValueOnce(
      new Error('Database unavailable'),
    );
    await expect(
      f.sms.sendOutboundSms({
        prospect: f.prospect,
        content: 'Hello',
        type: ThreadEventType.STAFF_OUTBOUND,
      }),
    ).rejects.toThrow('Database unavailable');
    const job = [...f.records.values()].find((record) => record.data.eventId);
    job.data.nextAttemptAt = 0;
    await f.sms.processSmsQueues();
    expect(f.provider.send).toHaveBeenCalledTimes(2);
    expect(f.provider.send.mock.calls[1]).toEqual(
      f.provider.send.mock.calls[0],
    );
    expect(f.events.get(job.key).deliveryStatus).toBe('pending');
  });

  it('reuses an automated step event after a scheduler restart', async () => {
    const f = fixture();
    const options = {
      prospect: f.prospect,
      content: 'Hello',
      type: ThreadEventType.AUTOMATED_OUTBOUND as const,
    };
    const first = await f.sms.sendOutboundSms(options);
    const next = await f.sms.sendOutboundSms(options);
    expect(first.id).toBe(next.id);
    expect(f.provider.send).toHaveBeenCalledTimes(1);
  });

  const inbound = {
    sender: '61412345678',
    to: '61411111111',
    message: 'Yes please',
    received_at: '2026-10-22 10:00:00',
    type: 'inbound',
    original_custom_ref: '',
  };

  it('durably deduplicates webhook retries before processing', async () => {
    const f = fixture();
    await f.sms.enqueueWebhook('inbound', inbound);
    await f.sms.enqueueWebhook('inbound', { ...inbound });
    expect(f.records.size).toBe(1);
    expect(f.events.size).toBe(0);
    await f.sms.processSmsQueues();
    expect(
      [...f.events.values()]
        .find((e) => e.direction === 'inbound')
        .timestamp.toISOString(),
    ).toBe('2026-10-22T10:00:00.000Z');
    expect(f.store.notifyOwner).toHaveBeenCalledTimes(1);
    await f.sms.processSmsQueues();
    expect(f.store.notifyOwner).toHaveBeenCalledTimes(1);
  });

  it('retains ambiguous replies for review instead of choosing the latest prospect', async () => {
    const f = fixture();
    f.store.unambiguousProspect.mockResolvedValue(null);
    await f.sms.enqueueWebhook('inbound', inbound);
    await f.sms.processSmsQueues();
    expect(f.events.size).toBe(0);
    expect([...f.records.values()][0].data.state).toBe('pending');
  });

  it('suppresses provider unsubscribe events even when receiving rooftop is unknown', async () => {
    const f = fixture();
    await f.sms.enqueueWebhook('inbound', {
      ...inbound,
      to: '61499999999',
      type: 'unsubscribe',
      message: 'Stop please',
    });
    await f.sms.processSmsQueues();
    expect(f.compliance.addSuppression).toHaveBeenCalled();
    expect(f.provider.send).not.toHaveBeenCalled();
  });

  it('resumes an interrupted inbound claim under the durable inbox lease', async () => {
    const f = fixture();
    f.store.claimCarrierMessage.mockResolvedValue(false);
    await f.sms.enqueueWebhook('inbound', inbound);
    const inbox = [...f.records.values()][0];
    f.records.set('carrier_message' + inbox.key, {
      key: inbox.key,
      data: { state: 'processing' },
    });
    await f.sms.processSmsQueues();
    expect(f.records.get('sms_inbox' + inbox.key).data.state).toBe('done');
    expect(f.store.notifyOwner).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid delivery parts before acknowledging them', async () => {
    const f = fixture();
    await expect(
      f.sms.enqueueWebhook('delivery', {
        sender: '61411111111',
        to: '61412345678',
        message_id: 'provider-1',
        status: 'delivered',
        received_at: '2026-10-22 10:00:00',
        part_number: 0,
        total_parts: 1,
      }),
    ).rejects.toThrow();
    expect(f.records.size).toBe(0);
  });

  it('retains a receipt addressed to the wrong rooftop instead of updating the thread', async () => {
    const f = fixture();
    f.events.set('event', {
      id: 'event',
      metadata: { from: '+61411111111', to: '+61412345678' },
      deliveryStatus: 'pending',
    });
    await f.sms.enqueueWebhook('delivery', {
      sender: '61499999999',
      to: '61412345678',
      message_id: 'provider-1',
      custom_ref: 'event',
      status: 'delivered',
      received_at: '2026-10-22 10:00:00',
      part_number: 1,
      total_parts: 1,
    });
    await f.sms.processSmsQueues();
    expect(f.events.get('event').deliveryStatus).toBe('pending');
    expect([...f.records.values()][0].data.attempts).toBe(1);
  });

  it('requires all parts delivered and ignores stale sent callbacks', async () => {
    const f = fixture();
    f.events.set('event', {
      id: 'event',
      metadata: { from: '+61411111111', to: '+61412345678' },
      deliveryStatus: 'pending',
    });
    const receipt = {
      sender: '61411111111',
      to: '61412345678',
      message_id: 'provider-1',
      custom_ref: 'event',
      status: 'delivered',
      received_at: '2026-10-22 10:00:00',
      part_number: 1,
      total_parts: 2,
    };
    await f.sms.enqueueWebhook('delivery', receipt);
    await f.sms.processSmsQueues();
    expect(f.events.get('event').deliveryStatus).toBe('pending');
    await f.sms.enqueueWebhook('delivery', { ...receipt, part_number: 2 });
    await f.sms.processSmsQueues();
    expect(f.events.get('event').deliveryStatus).toBe('delivered');
    await f.sms.enqueueWebhook('delivery', {
      ...receipt,
      status: 'sent',
      received_at: '2026-10-22 09:59:00',
    });
    await f.sms.processSmsQueues();
    expect(f.events.get('event').deliveryStatus).toBe('delivered');
  });

  it('retains delivery reports that arrive before their outbound event', async () => {
    const f = fixture();
    await f.sms.enqueueWebhook('delivery', {
      sender: '61411111111',
      to: '61412345678',
      message_id: 'provider-1',
      custom_ref: 'event',
      status: 'delivered',
      received_at: '2026-10-22 10:00:00',
      part_number: 1,
      total_parts: 1,
    });
    await f.sms.processSmsQueues();
    const record = [...f.records.values()][0];
    expect(record.data.state).toBe('pending');
    record.data.nextAttemptAt = 0;
    f.events.set('event', {
      id: 'event',
      metadata: { from: '+61411111111', to: '+61412345678' },
    });
    await f.sms.processSmsQueues();
    expect(f.events.get('event').deliveryStatus).toBe('delivered');
  });

  it('marks a multipart message failed when one part fails', async () => {
    const f = fixture();
    f.events.set('event', {
      id: 'event',
      metadata: { from: '+61411111111', to: '+61412345678' },
      deliveryStatus: 'pending',
    });
    await f.sms.enqueueWebhook('delivery', {
      sender: '61411111111',
      to: '61412345678',
      message_id: 'provider-1',
      custom_ref: 'event',
      status: 'failed',
      received_at: '2026-10-22 10:00:00',
      part_number: 1,
      total_parts: 2,
    });
    await f.sms.processSmsQueues();
    expect(f.events.get('event').deliveryStatus).toBe('failed');
  });

  it('verifies exact raw bytes over HTTP and rejects tampering, replay and missing signatures', async () => {
    process.env.MOBILEMESSAGE_WEBHOOK_SECRET = 'local-test-only';
    delete process.env.WEBHOOK_TEST_TOKEN;
    const f = fixture();
    const module = await Test.createTestingModule({
      controllers: [SmsController],
      providers: [{ provide: SmsService, useValue: f.sms }],
    }).compile();
    const app = module.createNestApplication<NestExpressApplication>({
      rawBody: true,
      logger: false,
    });
    app.useBodyParser('json', { limit: '256kb' });
    app.useGlobalGuards(new WebhookGuard());
    await app.init();
    try {
      const body = JSON.stringify(inbound, null, 2);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const sign = (ts: string) =>
        createHmac('sha256', 'local-test-only')
          .update(ts + '.' + body)
          .digest('hex');
      const send = (raw: string, ts = timestamp, signature = sign(ts)) =>
        request(app.getHttpServer())
          .post('/api/sms/inbound')
          .set('Content-Type', 'application/json')
          .set('x-mm-timestamp', ts)
          .set('x-mm-signature', signature)
          .send(raw);
      await send(body).expect(200);
      await send(body.replace('Yes please', 'Tampered')).expect(401);
      await send(body, String(Number(timestamp) - 600)).expect(401);
      await send(body, timestamp, 'bad').expect(401);
      await request(app.getHttpServer())
        .post('/api/sms/inbound')
        .send(inbound)
        .expect(401);
      process.env.NODE_ENV = 'production';
      process.env.WEBHOOK_TEST_TOKEN = 'test-bypass';
      await request(app.getHttpServer())
        .post('/api/sms/inbound')
        .set('x-webhook-test-token', 'test-bypass')
        .send(inbound)
        .expect(401);
      expect(f.records.size).toBe(1);
    } finally {
      await app.close();
    }
  });
});
