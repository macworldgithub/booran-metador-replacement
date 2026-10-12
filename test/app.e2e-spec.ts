import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { RooftopId, ProspectStatus } from '../src/common/enums';

describe('Booran Matador Replacement APIs (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Rooftops & Identities', () => {
    it('GET /api/rooftops returns Cranbourne Kia, MG, and Geely', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/rooftops')
        .expect(200);

      expect(res.body).toHaveLength(3);
      const ids = res.body.map((r: any) => r.id);
      expect(ids).toContain(RooftopId.CRANBOURNE_KIA);
      expect(ids).toContain(RooftopId.CRANBOURNE_MG);
      expect(ids).toContain(RooftopId.GEELY_CRANBOURNE);
    });
  });

  describe('2. Lead Intake & 14-Day Deduplication', () => {
    let createdProspectId: string;

    it('POST /api/leads/ingest - starts Step 1 for valid new lead', async () => {
      const payload = {
        dealerSocketOpportunityId: 'OPP-1001',
        rooftopId: RooftopId.CRANBOURNE_KIA,
        customer: {
          firstName: 'Sarah',
          lastName: 'Connor',
          mobile: '0412 888 999',
          email: 'sarah.c@example.com',
        },
        vehicle: {
          make: 'Kia',
          model: 'Sportage GT-Line',
          year: 2026,
          isNew: true,
        },
        leadSource: 'carsales',
        salesperson: {
          name: 'David Miller',
          email: 'david.m@booran.com.au',
        },
      };

      const res = await request(app.getHttpServer())
        .post('/api/leads/ingest')
        .send(payload)
        .expect(201);

      expect(res.body.intakeStatus).toBe('journey_started');
      expect(res.body.prospect).toBeDefined();
      expect(res.body.prospect.normalizedMobile).toBe('+61412888999');
      createdProspectId = res.body.prospect.id;
    });

    it('POST /api/leads/ingest - 14-day duplicate on same mobile + rooftop joins existing thread', async () => {
      const duplicatePayload = {
        dealerSocketOpportunityId: 'OPP-1002', // different opp ID
        rooftopId: RooftopId.CRANBOURNE_KIA,
        customer: {
          firstName: 'Sarah',
          mobile: '+61412888999', // same mobile
        },
        vehicle: {
          make: 'Kia',
          model: 'Sorento',
        },
        leadSource: 'website',
      };

      const res = await request(app.getHttpServer())
        .post('/api/leads/ingest')
        .send(duplicatePayload)
        .expect(201);

      expect(res.body.intakeStatus).toBe('duplicate_merged');
      expect(res.body.prospect.id).toBe(createdProspectId);
    });

    it('POST /api/leads/ingest - flags landline / invalid phone and skips journey', async () => {
      const landlinePayload = {
        dealerSocketOpportunityId: 'OPP-1003',
        rooftopId: RooftopId.CRANBOURNE_MG,
        customer: {
          firstName: 'Bob',
          mobile: '03 9555 1234', // Melbourne landline
        },
        leadSource: 'walk-in',
      };

      const res = await request(app.getHttpServer())
        .post('/api/leads/ingest')
        .send(landlinePayload)
        .expect(201);

      expect(res.body.intakeStatus).toBe('rejected_invalid_number');
      expect(res.body.prospect.status).toBe(ProspectStatus.CLOSED);
    });
  });

  describe('3. Unified Chronological Thread & Staff Messaging', () => {
    let testProspectId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/leads/ingest')
        .send({
          dealerSocketOpportunityId: 'OPP-2001',
          rooftopId: RooftopId.CRANBOURNE_MG,
          customer: {
            firstName: 'Alex',
            mobile: '0433 111 222',
          },
          vehicle: {
            make: 'MG',
            model: 'MG4 EV',
          },
          leadSource: 'website',
        });
      testProspectId = res.body.prospect.id;
    });

    it('GET /api/prospects/:id/thread - returns ordered timeline', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/prospects/${testProspectId}/thread`)
        .expect(200);

      expect(res.body.events).toBeDefined();
      expect(res.body.events.length).toBeGreaterThanOrEqual(1);
      // If during send hours (9:00-20:00 Melbourne), event is automated_outbound; if after hours, system queue event
      expect(['automated_outbound', 'system']).toContain(res.body.events[0].type);
    });

    it('POST /api/prospects/:id/messages - staff send pauses journey and intercalates into thread', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/prospects/${testProspectId}/messages`)
        .send({
          content: 'Hi Alex, we have the MG4 EV available for a test drive at 2pm today.',
          authorName: 'Chris Taylor',
        })
        .expect(201);

      expect(res.body.type).toBe('staff_outbound');
      expect(res.body.authorName).toBe('Chris Taylor');

      // Verify journey is paused
      const prospectRes = await request(app.getHttpServer())
        .get(`/api/prospects/${testProspectId}`)
        .expect(200);
      expect(prospectRes.body.journey.status).toBe('paused');
    });

    it('POST /api/prospects/:id/notes - internal note is saved to thread', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/prospects/${testProspectId}/notes`)
        .send({
          content: 'Customer is eligible for Victoria EV rebate.',
          authorName: 'Chris Taylor',
        })
        .expect(201);

      expect(res.body.type).toBe('internal_note');
      expect(res.body.direction).toBe('internal');
    });
  });

  describe('4. Inbound Customer Replies & Spam Act STOP Opt-Out', () => {
    let testProspectId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/leads/ingest')
        .send({
          dealerSocketOpportunityId: 'OPP-3001',
          rooftopId: RooftopId.GEELY_CRANBOURNE,
          customer: {
            firstName: 'Emma',
            mobile: '0455 333 444',
          },
          leadSource: 'facebook',
        });
      testProspectId = res.body.prospect.id;
    });

    it('POST /api/sms/inbound - customer normal reply pauses journey and sets waiting_on_us', async () => {
      await request(app.getHttpServer())
        .post('/api/sms/inbound')
        .send({
          from: '0455 333 444',
          to: '+61488800217', // Geely sender number
          body: 'Yes, what warranty does the Geely come with?',
        })
        .expect(201);

      const prospectRes = await request(app.getHttpServer())
        .get(`/api/prospects/${testProspectId}`)
        .expect(200);

      expect(prospectRes.body.status).toBe(ProspectStatus.WAITING_ON_US);
      expect(prospectRes.body.journey.status).toBe('paused');
    });

    it('POST /api/sms/inbound - STOP keyword suppresses across all 3 rooftops immediately', async () => {
      await request(app.getHttpServer())
        .post('/api/sms/inbound')
        .send({
          from: '0455 333 444',
          to: '+61488800217',
          body: 'STOP',
        })
        .expect(201);

      // Verify prospect is marked opted_out
      const prospectRes = await request(app.getHttpServer())
        .get(`/api/prospects/${testProspectId}`)
        .expect(200);
      expect(prospectRes.body.status).toBe(ProspectStatus.OPTED_OUT);

      // Verify global suppression list
      const suppRes = await request(app.getHttpServer())
        .get('/api/compliance/suppressions')
        .expect(200);
      const suppressedMobiles = suppRes.body.map((s: any) => s.mobile);
      expect(suppressedMobiles).toContain('+61455333444');

      // Verify thread contains confirmation message
      const threadRes = await request(app.getHttpServer())
        .get(`/api/prospects/${testProspectId}/thread`)
        .expect(200);
      const lastEvent = threadRes.body.events[threadRes.body.events.length - 1];
      expect(lastEvent.content).toContain('unsubscribed');
    });
  });

  describe('5. Outcomes & CRM Write-back Audit', () => {
    it('PATCH /api/prospects/:id/outcome - records appointment requested and queues sync', async () => {
      const prospectRes = await request(app.getHttpServer())
        .get('/api/prospects')
        .expect(200);
      const prospect = prospectRes.body[0];

      const res = await request(app.getHttpServer())
        .patch(`/api/prospects/${prospect.id}/outcome`)
        .send({
          outcome: 'appointment_requested',
          notes: 'Test drive confirmed for Saturday',
        })
        .expect(200);

      expect(res.body.outcome).toBe('appointment_requested');

      // Check write-back log
      const writebackRes = await request(app.getHttpServer())
        .get('/api/writeback/logs')
        .expect(200);
      expect(writebackRes.body.length).toBeGreaterThan(0);
    });
  });
});
