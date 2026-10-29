import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import axios from 'axios';
import request = require('supertest');
import { DealerSocketModule } from '../src/modules/dealersocket/dealersocket.module';
import { StoreService } from '../src/modules/database/store.service';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { sanitizeLiveLeads } from '../src/modules/dealersocket/live-leads';
import { RooftopId, UserRole } from '../src/common/enums';
import { OperationsController } from '../src/modules/operations/operations.controller';
import { OperationsService } from '../src/modules/operations/operations.service';

const snapshot = {
  state: 'connected', operation: null, lastCheckedAt: '2026-10-15T09:00:00Z',
  lastConnectedAt: '2026-10-15T09:00:00Z', sessionExpiresAt: null, errorCode: null,
  message: 'DealerSocket session verified.', interactiveLoginEnabled: true,
  rooftops: [{ id: 'cranbourne_kia', name: 'Cranbourne Kia', verified: true },
    { id: 'cranbourne_mg', name: 'Cranbourne MG', verified: false },
    { id: 'geely_cranbourne', name: 'Geely Cranbourne', verified: false }],
};

describe('DealerSocket session API (offline; no browser/database)', () => {
  let app: INestApplication;
  const audit = jest.fn().mockResolvedValue({});
  const saved = { key: process.env.DEALERSOCKET_CONNECTOR_KEY, url: process.env.DEALERSOCKET_CONNECTOR_URL };
  beforeAll(async () => {
    // Register OperationsController too: its legacy heartbeat must never shadow session status.
    const module = await Test.createTestingModule({ imports: [DealerSocketModule], controllers: [OperationsController] })
      .useMocker(token => token === StoreService ? { audit, recordGet: jest.fn().mockResolvedValue(null) } :
        token === OperationsService ? {} : undefined).compile();
    app = module.createNestApplication({ logger: false });
    // Synthetic identities test this module's real RolesGuard; existing JWT validation is unchanged.
    app.useGlobalGuards({ canActivate(context) {
      const req = context.switchToHttp().getRequest();
      if (!req.headers['x-test-role']) throw new UnauthorizedException();
      req.user = { id: 'test', role: req.headers['x-test-role'], name: 'Test Admin', email:'admin@example.test', rooftopIds:['cranbourne_kia'] };
      return true;
    } }, new RolesGuard(app.get(Reflector)));
    await app.init();
  });
  beforeEach(() => {
    process.env.DEALERSOCKET_CONNECTOR_KEY = 'test-connector-key-at-least-32-characters';
    process.env.DEALERSOCKET_CONNECTOR_URL = 'http://127.0.0.1:8000';
    audit.mockClear();
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    for (const [key, value] of Object.entries({ DEALERSOCKET_CONNECTOR_KEY: saved.key, DEALERSOCKET_CONNECTOR_URL: saved.url })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await app.close();
  });
  it('rejects unauthenticated and all non-admin identities without dispatch', async () => {
    const upstream = jest.spyOn(axios, 'request').mockResolvedValue({ data: snapshot });
    await request(app.getHttpServer()).get('/api/integrations/dealersocket/status').expect(401);
    for (const role of ['salesperson', 'sales_manager', 'bdc', 'read_only']) {
      await request(app.getHttpServer()).post('/api/integrations/dealersocket/login/start').set('x-test-role', role).expect(403);
    }
    expect(upstream).not.toHaveBeenCalled();
  });
  it('forwards actions with a server-only key, audits them and strips unknown fields', async () => {
    const upstream = jest.spyOn(axios, 'request').mockResolvedValue({ data: { ...snapshot, cookies: ['secret'] } });
    const res = await request(app.getHttpServer()).post('/api/integrations/dealersocket/check').set('x-test-role', 'group_admin').expect(202);
    expect(res.body).toEqual(snapshot);
    expect(upstream).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', maxRedirects: 0,
      headers: expect.objectContaining({ 'X-Connector-Key': process.env.DEALERSOCKET_CONNECTOR_KEY }) }));
    expect(audit).toHaveBeenCalledWith('dealersocket_session_requested', expect.any(Object), { action: 'check' });
  });
  it('keeps session status separate from the legacy scraper heartbeat', async () => {
    const upstream = jest.spyOn(axios, 'request').mockResolvedValue({ data: snapshot });
    const status = await request(app.getHttpServer()).get('/api/integrations/dealersocket/status').set('x-test-role', 'group_admin').expect(200);
    expect(status.body).toEqual(snapshot);
    expect(upstream).toHaveBeenCalledTimes(1);
    const heartbeat = await request(app.getHttpServer()).get('/api/integrations/dealersocket/heartbeat/status').set('x-test-role', 'group_admin').expect(200);
    expect(heartbeat.body.status).toBe('never_connected');
    await request(app.getHttpServer()).get('/api/integrations/dealersocket/heartbeat/status').set('x-test-role', 'salesperson').expect(403);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
  it('allows only admins to open visible automatic login and audits the action', async () => {
    const upstream = jest.spyOn(axios, 'request').mockResolvedValue({ data: snapshot });
    await request(app.getHttpServer()).post('/api/integrations/dealersocket/login/automatic/start').set('x-test-role', 'salesperson').expect(403);
    expect(upstream).not.toHaveBeenCalled();
    await request(app.getHttpServer()).post('/api/integrations/dealersocket/login/automatic/start').set('x-test-role', 'group_admin').expect(202);
    expect(upstream).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', url: expect.stringContaining('/dealersocket/login/automatic/start') }));
    expect(audit).toHaveBeenCalledWith('dealersocket_session_requested', expect.any(Object), { action: 'login/automatic/start' });
  });
  it('accepts lead-read activity without rewriting verification timestamps', async () => {
    const reading = {...snapshot,state:'connecting',operation:'read',message:'Lead read in progress. Session checks resume when it finishes.',
      rooftops:snapshot.rooftops.map(roof=>({...roof,verified:false}))};
    jest.spyOn(axios,'request').mockResolvedValue({data:reading});
    const response = await request(app.getHttpServer()).get('/api/integrations/dealersocket/status').set('x-test-role','group_admin').expect(200);
    expect(response.body).toEqual(reading);
  });
  it('fails closed for missing configuration and remote cleartext connectors', async () => {
    const upstream = jest.spyOn(axios, 'request');
    process.env.DEALERSOCKET_CONNECTOR_KEY = '';
    await request(app.getHttpServer()).get('/api/integrations/dealersocket/status').set('x-test-role', 'group_admin').expect(503);
    process.env.DEALERSOCKET_CONNECTOR_KEY = 'test-connector-key-at-least-32-characters';
    process.env.DEALERSOCKET_CONNECTOR_URL = 'http://remote.example.test:8000';
    await request(app.getHttpServer()).get('/api/integrations/dealersocket/status').set('x-test-role', 'group_admin').expect(503);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('rejects malformed responses and does not echo connector exceptions', async () => {
    const upstream = jest.spyOn(axios, 'request').mockResolvedValue({ data: { ...snapshot, rooftops: [] } });
    await request(app.getHttpServer()).get('/api/integrations/dealersocket/status').set('x-test-role', 'group_admin').expect(502);
    upstream.mockRejectedValue(new Error('secret-cookie-value'));
    const res = await request(app.getHttpServer()).get('/api/integrations/dealersocket/status').set('x-test-role', 'group_admin').expect(503);
    expect(JSON.stringify(res.body)).not.toContain('secret-cookie-value');
  });

  const rawLead = (id: string, rooftop: string, owner: string) => ({ record_key:`site|sales|${id}|customer`,
    opportunity_id:id,customer_id:`c${id}`,rooftop,customer_name:'Synthetic Customer',customer_phone:'+61412345678',
    assigned_salesperson:owner,detail_extracted:true,list_observed_at:'2026-10-15T09:00:00Z',cookies:'private' });
  const rawLeads = {state:'partial',readOnly:true,jobId:'job-one',fetchedAt:'2026-10-15T09:00:00Z',durationSeconds:40,
    records:[rawLead('1','Cranbourne Kia','Test Admin'),rawLead('2','Cranbourne Kia','Other Owner'),
      rawLead('3','Cranbourne Kia','Unassigned'),rawLead('4','Cranbourne MG','Other Owner')],
    rooftops:[{name:'Cranbourne Kia',matchedCandidateCount:61},{name:'Cranbourne MG',matchedCandidateCount:30}],
    errors:[],review:[],token:'private',limited:false};
  it('filters live records and summary metadata by rooftop and salesperson ownership', async () => {
    const upstream=jest.spyOn(axios,'request').mockResolvedValue({data:rawLeads});
    const staff=await request(app.getHttpServer()).get('/api/integrations/dealersocket/leads/status').set('x-test-role','salesperson').expect(200);
    expect(staff.body.records.map((r:any)=>r.opportunityId)).toEqual(['1','3']);
    expect(staff.body.rooftops).toHaveLength(1);
    expect(staff.body.rooftops[0].matchedCandidateCount).toBeNull();
    expect(JSON.stringify(staff.body)).not.toContain('Cranbourne MG');
    expect(JSON.stringify(staff.body)).not.toContain('private');
    expect(audit).not.toHaveBeenCalled();
    const manager=await request(app.getHttpServer()).get('/api/integrations/dealersocket/leads/status').set('x-test-role','sales_manager').expect(200);
    expect(manager.body.records).toHaveLength(3);
    expect(upstream).toHaveBeenCalledWith(expect.objectContaining({method:'GET'}));
  });
  it('allows scoped read-only users to view snapshots, while only admin may start a read', async () => {
    const upstream=jest.spyOn(axios,'request').mockResolvedValue({data:rawLeads});
    await request(app.getHttpServer()).get('/api/integrations/dealersocket/leads/status').set('x-test-role','read_only').expect(200);
    for(const role of ['salesperson','sales_manager','bdc','read_only'])
      await request(app.getHttpServer()).post('/api/integrations/dealersocket/leads/read').set('x-test-role',role).expect(403);
    const result=await request(app.getHttpServer()).post('/api/integrations/dealersocket/leads/read').set('x-test-role','group_admin').expect(202);
    expect(result.body.records).toHaveLength(4);
    expect(upstream).toHaveBeenLastCalledWith(expect.objectContaining({method:'POST',data:{maxRecords:1000,detailLimit:200}}));
    expect(audit).toHaveBeenCalledWith('dealersocket_snapshot_requested',expect.any(Object),{action:'leads/read'});
  });
  it('denies empty rooftop scopes and rejects invalid live snapshot identities', () => {
    const actor={id:'a',name:'Staff',email:'staff@example.test',role:UserRole.SALESPERSON,rooftopIds:[] as RooftopId[]};
    expect(sanitizeLiveLeads(rawLeads,actor).records).toEqual([]);
    expect(sanitizeLiveLeads(rawLeads,actor).rooftops).toEqual([]);
    expect(()=>sanitizeLiveLeads({...rawLeads,records:[{...rawLeads.records[0],rooftop:'Unknown'}]},actor)).toThrow();
  });
  it('reports browser contention without leaking upstream data', async () => {
    jest.spyOn(axios,'request').mockRejectedValue({isAxiosError:true,response:{status:409,data:{token:'private'}}});
    const result=await request(app.getHttpServer()).post('/api/integrations/dealersocket/leads/read').set('x-test-role','group_admin').expect(409);
    expect(JSON.stringify(result.body)).not.toContain('private');
  });
  it('scopes persisted rows during scheduled refresh and failures without changing their timestamp', () => {
    const actor={id:'a',name:'Test Admin',email:'staff@example.test',role:UserRole.SALESPERSON,rooftopIds:[RooftopId.CRANBOURNE_KIA]};
    for(const state of ['running','error']) {
      const result=sanitizeLiveLeads({...rawLeads,state,snapshotState:'partial',code:'login_required',
        schedule:{enabled:true,intervalSeconds:3600,nextRunAt:'2026-10-15T10:00:00Z',key:'private'}},actor);
      expect(result.records.map(r=>r.opportunityId)).toEqual(['1','3']);
      expect(result.snapshotState).toBe('partial');
      expect(result.fetchedAt).toBe(rawLeads.fetchedAt);
      expect(result.schedule).toEqual({enabled:true,intervalSeconds:3600,nextRunAt:'2026-10-15T10:00:00Z'});
      expect(result.rooftops[0].matchedCandidateCount).toBeNull();
      expect(JSON.stringify(result)).not.toContain('private');
    }
  });
});
