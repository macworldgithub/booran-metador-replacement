import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  MongooseModule,
  getConnectionToken,
  getModelToken,
} from '@nestjs/mongoose';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Connection, Model } from 'mongoose';
import request = require('supertest');
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import * as ts from 'typescript';
import { AuthService } from '../src/modules/auth/auth.service';
import { AuthController } from '../src/modules/auth/auth.controller';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt.guard';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { ConversationsController } from '../src/modules/conversations/conversations.controller';
import { ConversationsService } from '../src/modules/conversations/conversations.service';
import { StoreService } from '../src/modules/database/store.service';
import {
  MobileMessageService,
  MobileMessageError,
} from '../src/modules/sms/mobile-message.service';
import { SmsService } from '../src/modules/sms/sms.service';
import { JourneyService } from '../src/modules/journey/journey.service';
import { ComplianceService } from '../src/modules/compliance/compliance.service';
import { WritebackService } from '../src/modules/writeback/writeback.service';
import {
  Prospect,
  ProspectSchema,
  ThreadEvent,
  ThreadEventSchema,
  Suppression,
  SuppressionSchema,
  WritebackLog,
  WritebackLogSchema,
  User,
  UserSchema,
} from '../src/modules/database/schemas';
import { RooftopId, ProspectStatus, UserRole } from '../src/common/enums';

jest.setTimeout(60000);
const suite = process.env.MONGODB_URI ? describe : describe.skip;
suite('Conversation portal: HTTP, JWT, services and isolated MongoDB', () => {
  let app: INestApplication;
  let db: Connection;
  let store: StoreService;
  let sms: SmsService;
  let admin: string;
  let staff: string;
  let manager: string;
  let readOnly: string;
  let noRooftops: string;
  let id: string;
  let foreign: string;
  let ownedByOther: string;
  let expired: string;
  let userModel: Model<User>;
  const savedEnvironment = {
    MOBILEMESSAGE_TEST_RECIPIENT: process.env.MOBILEMESSAGE_TEST_RECIPIENT,
    JWT_SECRET: process.env.JWT_SECRET,
    DS_CLIENT_ID: process.env.DS_CLIENT_ID,
    DS_CLIENT_SECRET: process.env.DS_CLIENT_SECRET,
  };
  const dbName =
    process.env.PORTAL_E2E_DB ||
    `portal_e2e_${Date.now()}_${randomUUID().slice(0, 8)}`;
  beforeAll(async () => {
    delete process.env.MOBILEMESSAGE_TEST_RECIPIENT;
    if (!/^portal_e2e_[a-zA-Z0-9_]+$/.test(dbName))
      throw new Error('Use an isolated portal_e2e_ database only');
    process.env.JWT_SECRET = 'conversation-test-only';
    process.env.DS_CLIENT_ID = '';
    process.env.DS_CLIENT_SECRET = '';
    const module = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({
          secret: 'conversation-test-only',
          signOptions: { expiresIn: '1h' },
        }),
        MongooseModule.forRoot(process.env.MONGODB_URI!, {
          dbName,
          serverSelectionTimeoutMS: 10000,
        }),
        MongooseModule.forFeature([
          { name: Prospect.name, schema: ProspectSchema },
          { name: ThreadEvent.name, schema: ThreadEventSchema },
          { name: Suppression.name, schema: SuppressionSchema },
          { name: WritebackLog.name, schema: WritebackLogSchema },
          { name: User.name, schema: UserSchema },
        ]),
      ],
      controllers: [AuthController, ConversationsController],
      providers: [
        AuthService,
        JwtStrategy,
        StoreService,
        ConversationsService,
        SmsService,
        {
          provide: MobileMessageService,
          useValue: { send: jest.fn(async () => randomUUID()) },
        },
        JourneyService,
        ComplianceService,
        WritebackService,
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    const reflector = app.get(Reflector);
    app.useGlobalGuards(new JwtAuthGuard(reflector), new RolesGuard(reflector));
    await app.init();
    db = app.get(getConnectionToken());
    store = app.get(StoreService);
    await store.initializeOperations();
    sms = app.get(SmsService);
    userModel = app.get(getModelToken(User.name));
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@booran.com.au', password: 'Admin@2026!' })
      .expect(201);
    admin = login.body.accessToken;
    const jwt = app.get(JwtService);
    async function identity(
      role: UserRole,
      rooftops: RooftopId[],
      name: string,
    ) {
      const user = await userModel.create({
        name,
        email: `${randomUUID()}@example.test`,
        passwordHash: 'not-used',
        role,
        rooftopIds: rooftops,
        isActive: true,
      });
      return { token: jwt.sign({ sub: user._id.toString() }), user };
    }
    staff = (
      await identity(
        UserRole.SALESPERSON,
        [RooftopId.CRANBOURNE_KIA],
        'Portal Staff',
      )
    ).token;
    manager = (
      await identity(
        UserRole.SALES_MANAGER,
        [RooftopId.CRANBOURNE_KIA],
        'Portal Manager',
      )
    ).token;
    readOnly = (
      await identity(
        UserRole.READ_ONLY,
        [RooftopId.CRANBOURNE_KIA],
        'Read User',
      )
    ).token;
    noRooftops = (await identity(UserRole.BDC, [], 'No Access')).token;
    const expUser = (await userModel.findOne({
      email: 'admin@booran.com.au',
    }))!;
    expired = jwt.sign({ sub: expUser._id.toString() }, { expiresIn: -1 });
  });
  beforeEach(async () => {
    if (!db) return;
    await Promise.all([
      db.collection('prospects').deleteMany({}),
      db.collection('thread_events').deleteMany({}),
      db.collection('suppressions').deleteMany({}),
      db.collection('writeback_logs').deleteMany({}),
      db.collection('portal_records').deleteMany({}),
    ]);
    id = `pr_${randomUUID()}`;
    foreign = `pr_${randomUUID()}`;
    ownedByOther = `pr_${randomUUID()}`;
    const now = new Date();
    const base = {
      dealerSocketOpportunityId: 'TEST-OPP',
      rooftopId: RooftopId.CRANBOURNE_KIA,
      customer: {
        firstName: 'Test',
        lastName: 'Prospect',
        mobile: '0491570006',
      },
      normalizedMobile: '+61491570006',
      vehicle: { make: 'Kia', model: 'Sportage' },
      leadSource: 'Portal E2E',
      status: ProspectStatus.WAITING_ON_US,
      journey: {
        status: 'paused' as const,
        currentStep: 1,
        currentStepName: 'Step 1: Ack',
      },
      unreadInboundCount: 2,
      lastActivityAt: now,
      lastInboundAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await store.saveProspect({ ...base, id });
    await store.saveProspect({
      ...base,
      id: foreign,
      rooftopId: RooftopId.CRANBOURNE_MG,
    });
    await store.saveProspect({
      ...base,
      id: ownedByOther,
      assignedTo: { name: 'Other Staff', email: 'other@example.test' },
    });
  });
  afterAll(async () => {
    try {
      if (db && db.name === dbName && /^portal_e2e_/.test(db.name))
        await Promise.all(
          [
            'prospects',
            'thread_events',
            'suppressions',
            'writeback_logs',
            'users',
            'portal_records',
          ].map((collection) => db.collection(collection).deleteMany({})),
        );
    } finally {
      if (app) await app.close();
      for (const [key, value] of Object.entries(savedEnvironment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
  const get = (path: string, token = admin) =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${token}`);
  const post = (suffix: string, body: object, token = admin) =>
    request(app.getHttpServer())
      .post(`/api/prospects/${id}/${suffix}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const patch = (suffix: string, body: object, token = admin) =>
    request(app.getHttpServer())
      .patch(`/api/prospects/${id}/${suffix}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  it('lists real prospects, filters safely and enforces rooftop/ownership scope', async () => {
    expect((await get('/api/prospects').expect(200)).body).toHaveLength(3);
    expect(
      (await get('/api/prospects', staff).expect(200)).body.map(
        (p: any) => p.id,
      ),
    ).toEqual([id]);
    expect((await get('/api/prospects', noRooftops).expect(200)).body).toEqual(
      [],
    );
    await get('/api/prospects?rooftopId=cranbourne_mg', staff).expect(403);
    await get('/api/prospects?status=bad').expect(400);
    expect((await get('/api/prospects?search=%5B').expect(200)).body).toEqual(
      [],
    );
    expect(
      (
        await get(
          '/api/prospects?rooftopId=cranbourne_kia&status=waiting_on_us&search=Sportage&ownerName=Other',
        ).expect(200)
      ).body,
    ).toHaveLength(1);
  });
  it('loads details, clears unread count, and returns chronological thread', async () => {
    const detail = await get(`/api/prospects/${id}`, staff).expect(200);
    expect(detail.body.unreadInboundCount).toBe(0);
    await post(
      'notes',
      { content: 'First note', authorName: 'Forged author' },
      staff,
    ).expect(201);
    const thread = await get(`/api/prospects/${id}/thread`, staff).expect(200);
    expect(thread.body.events[0].authorName).toBe('Portal Staff');
    expect(thread.body.events[0].type).toBe('internal_note');
    expect(thread.body.events.map((e: any) => e.timestamp)).toEqual(
      [...thread.body.events].map((e: any) => e.timestamp).sort(),
    );
  });
  it('sends staff SMS, adds compliant footer, persists delivery and pauses journey', async () => {
    const sent = await post(
      'messages',
      { content: 'Can we arrange a test drive?', authorName: 'Forged' },
      staff,
    ).expect(201);
    expect(sent.body.authorName).toBe('Portal Staff');
    expect(sent.body.content).toContain('Cranbourne Kia');
    expect(sent.body.content).toContain('Reply STOP');
    expect(sent.body.metadata.provider).toBe('mobilemessage');
    expect(sent.body.deliveryStatus).toBe('pending');
    const thread = await get(`/api/prospects/${id}/thread`).expect(200);
    expect(thread.body.prospect.journey.status).toBe('paused');
    expect(thread.body.events.some((e: any) => e.id === sent.body.id)).toBe(
      true,
    );
  });
  it('rejects invalid content and assignment email with 400', async () => {
    for (const content of ['', '   ', 123, 'x'.repeat(1601)])
      await post('messages', { content }).expect(400);
    await post('notes', { content: '  ' }).expect(400);
    await patch('assign', {
      salespersonName: 'Name',
      salespersonEmail: 'invalid',
    }).expect(400);
    await patch('outcome', { outcome: 'invalid' }).expect(400);
    await patch('journey', { action: 'invalid' }).expect(400);
  });
  it('supports pause, resume, skip step and stop without resurrecting an ended journey', async () => {
    expect(
      (await patch('journey', { action: 'resume' }).expect(200)).body.journey
        .status,
    ).toBe('active');
    expect(
      (
        await patch('journey', {
          action: 'pause',
          reason: 'Human takeover',
        }).expect(200)
      ).body.journey.status,
    ).toBe('paused');
    expect(
      (await patch('journey', { action: 'skip_step' }).expect(200)).body.journey
        .currentStep,
    ).toBe(2);
    expect(
      (await patch('journey', { action: 'stop' }).expect(200)).body.journey
        .status,
    ).toBe('stopped');
    await patch('journey', { action: 'resume' }).expect(400);
  });
  it('sets outcome and reassigns with CRM write-back records', async () => {
    const assignment = await patch(
      'assign',
      {
        salespersonName: 'Assigned Staff',
        salespersonEmail: 'assigned@example.test',
      },
      manager,
    ).expect(200);
    expect(assignment.body.assignedTo.email).toBe('assigned@example.test');
    const outcome = await patch(
      'outcome',
      { outcome: 'appointment_requested', notes: 'Saturday' },
      manager,
    ).expect(200);
    expect(outcome.body.journey.status).toBe('completed');
    expect(outcome.body.outcome).toBe('appointment_requested');
    const logs = await store.getWritebackLogs();
    expect(logs.map((l) => l.action)).toContain('assignment_changed');
    expect(logs.map((l) => l.action)).toContain(
      'outcome_appointment_requested',
    );
  });
  it('enforces 403 for foreign, other-owned and read-only mutations', async () => {
    for (const suffix of ['', '/thread']) {
      await get(`/api/prospects/${foreign}${suffix}`, staff).expect(403);
      await get(`/api/prospects/${ownedByOther}${suffix}`, staff).expect(403);
    }
    await post('messages', { content: 'Hello' }, readOnly).expect(403);
    await post('notes', { content: 'Note' }, readOnly).expect(403);
    for (const [action, body] of [
      ['journey', { action: 'pause' }],
      ['outcome', { outcome: 'wrong_number' }],
      ['assign', { salespersonName: 'Name' }],
    ] as const)
      await patch(action, body, readOnly).expect(403);
    await patch('assign', { salespersonName: 'Name' }, staff).expect(403);
    await request(app.getHttpServer())
      .post(`/api/prospects/${foreign}/notes`)
      .set('Authorization', `Bearer ${staff}`)
      .send({ content: 'no access' })
      .expect(403);
  });
  it('returns 401 for missing/expired/invalid authentication and 404 for unknown prospects', async () => {
    await request(app.getHttpServer()).get('/api/prospects').expect(401);
    await get('/api/prospects', expired).expect(401);
    await get('/api/prospects', 'invalid').expect(401);
    for (const suffix of ['', '/thread'])
      await get(`/api/prospects/missing${suffix}`).expect(404);
    await request(app.getHttpServer())
      .patch('/api/prospects/missing/journey')
      .set('Authorization', `Bearer ${admin}`)
      .send({ action: 'pause' })
      .expect(404);
  });
  it('suppression blocks SMS and resume, but keeps internal notes usable', async () => {
    await store.addSuppression('+61491570006', 'E2E STOP', 'keyword_opt_out');
    await post('messages', { content: 'blocked' }).expect(400);
    await patch('journey', { action: 'resume' }).expect(400);
    await store.updateProspect(id, { status: ProspectStatus.OPTED_OUT });
    await post('notes', { content: 'Team-only note after opt-out' }).expect(
      201,
    );
    await patch('outcome', { outcome: 'not_interested' }).expect(400);
  });
  it('carrier failures remain visible and a retry appends a new message', async () => {
    const provider = (sms as any).provider;
    provider.send.mockRejectedValueOnce(
      new MobileMessageError('Carrier test rejection'),
    );
    try {
      const failure = await post('messages', {
        content: 'Failure test',
      }).expect(201);
      expect(failure.body.deliveryStatus).toBe('failed');
      expect(failure.body.failureReason).toBe('Carrier test rejection');
    } finally {
      provider.send.mockImplementation(async () => randomUUID());
    }
    const retry = await post('messages', { content: 'Failure test' }).expect(
      201,
    );
    expect(retry.body.deliveryStatus).toBe('pending');
    const thread = await get(`/api/prospects/${id}/thread`).expect(200);
    expect(
      thread.body.events.filter((e: any) => e.type === 'staff_outbound'),
    ).toHaveLength(2);
  });
  it('returns 500 on database failure and recovers after the failure is removed', async () => {
    const spy = jest
      .spyOn(store, 'queryProspects')
      .mockRejectedValueOnce(new Error('Simulated database error'));
    await get('/api/prospects').expect(500);
    spy.mockRestore();
    await get('/api/prospects').expect(200);
  });
  it('runs all eight APIs through the real Next proxy, Nest HTTP server and MongoDB', async () => {
    if (!app.getHttpServer().listening) await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    const previousBase = process.env.API_BASE_URL;
    process.env.API_BASE_URL = `http://127.0.0.1:${address.port}/api`;
    const frontendRoot = resolve(
      __dirname,
      '../../metador-replacement-frontend',
    );
    const nativeRequire = createRequire(resolve(frontendRoot, 'package.json'));
    const cache = new Map<string, any>();
    function load(file: string): any {
      const filename = resolve(
        frontendRoot,
        file.endsWith('.ts') ? file : `${file}.ts`,
      );
      if (cache.has(filename)) return cache.get(filename);
      const output = ts.transpileModule(readFileSync(filename, 'utf8'), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText;
      const exported = {};
      cache.set(filename, exported);
      const req = (name: string) =>
        name.startsWith('@/')
          ? load(name.slice(2))
          : name.startsWith('.')
            ? load(resolve(dirname(filename), name))
            : nativeRequire(name);
      new Function('require', 'exports', output)(req, exported);
      return exported;
    }
    const { NextRequest } = nativeRequire('next/server');
    const authentication = load('app/api/auth/login/route');
    const proxy = load('app/api/prospects/[[...path]]/route');
    try {
      const loginResponse = await authentication.POST(
        new NextRequest('http://localhost:3001/api/auth/login', {
          method: 'POST',
          headers: {
            Origin: 'http://localhost:3001',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: 'admin@booran.com.au',
            password: 'Admin@2026!',
          }),
        }),
      );
      expect(loginResponse.status).toBe(200);
      const cookie = `booran_session=${loginResponse.cookies.get('booran_session').value}`;
      async function call(method: string, path: string[], body?: object) {
        const response = await proxy[method](
          new NextRequest(
            `http://localhost:3001/api/prospects${path.length ? '/' + path.join('/') : ''}`,
            {
              method,
              headers: {
                Cookie: cookie,
                Origin: 'http://localhost:3001',
                'Content-Type': 'application/json',
              },
              ...(body ? { body: JSON.stringify(body) } : {}),
            },
          ),
          { params: Promise.resolve({ path }) },
        );
        expect(response.status).toBe(method === 'POST' ? 201 : 200);
        return response.json();
      }
      expect((await call('GET', [])).length).toBe(3);
      expect((await call('GET', [id])).unreadInboundCount).toBe(0);
      expect(
        (
          await call('POST', [id, 'messages'], {
            content: 'Stacked SMS test',
            authorName: 'Forged',
          })
        ).authorName,
      ).toBe('Group Admin');
      expect(
        (
          await call('POST', [id, 'notes'], {
            content: 'Stacked internal note',
          })
        ).type,
      ).toBe('internal_note');
      expect(
        (await call('PATCH', [id, 'journey'], { action: 'resume' })).journey
          .status,
      ).toBe('active');
      expect(
        (
          await call('PATCH', [id, 'assign'], {
            salespersonName: 'Stacked Staff',
            salespersonEmail: 'stacked@example.test',
          })
        ).assignedTo.name,
      ).toBe('Stacked Staff');
      expect(
        (await call('PATCH', [id, 'outcome'], { outcome: 'not_interested' }))
          .status,
      ).toBe('closed');
      const thread = await call('GET', [id, 'thread']);
      expect(
        thread.events.some((e: any) => e.content === 'Stacked internal note'),
      ).toBe(true);
      const { mapProspect } = load('lib/conversations');
      const model = mapProspect(thread.prospect);
      expect(model.name).toBe('Test Prospect');
      expect(model.owner).toBe('Stacked Staff');
      expect(model.status).toBe('Closed');
    } finally {
      if (previousBase === undefined) delete process.env.API_BASE_URL;
      else process.env.API_BASE_URL = previousBase;
    }
  });
  const browserIt = process.env.RUN_PORTAL_BROWSER === '1' ? it : it.skip;
  browserIt(
    'verifies complete desktop and mobile workflows in headless Edge',
    async () => {
      if (!app.getHttpServer().listening) await app.listen(0, '127.0.0.1');
      const port = app.getHttpServer().address().port;
      const frontendRoot = resolve(
        __dirname,
        '../../metador-replacement-frontend',
      );
      const result = await new Promise<object>((done, reject) => {
        const child = spawn(
          process.execPath,
          [resolve(frontendRoot, 'tests/browser-portal.mjs'), '--run'],
          {
            windowsHide: true,
            cwd: frontendRoot,
            env: {
              ...process.env,
              PORTAL_BROWSER_BACKEND: `http://127.0.0.1:${port}/api`,
              PORTAL_BROWSER_PROSPECT: id,
              PORTAL_BROWSER_EMAIL: 'admin@booran.com.au',
              PORTAL_BROWSER_PASSWORD: 'Admin@2026!',
            },
          },
        );
        let output = '';
        let error = '';
        child.stdout.on('data', (data) => {
          output += data.toString();
        });
        child.stderr.on('data', (data) => {
          error += data.toString();
        });
        child.on('error', reject);
        child.on('exit', (code) => {
          if (code !== 0)
            reject(new Error(`Browser workflow failed: ${error}`));
          else {
            try {
              done(JSON.parse(output.trim()));
            } catch {
              reject(new Error('Invalid browser test result'));
            }
          }
        });
      });
      expect(result).toEqual({ desktop: true, mobile: true, runtimeErrors: 0 });
    },
    120000,
  );
});
