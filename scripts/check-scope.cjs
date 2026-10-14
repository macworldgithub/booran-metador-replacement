// Offline checks only: no HTTP calls, database connections or customer messages.
require('reflect-metadata');
const assert = require('node:assert/strict');
const { Test } = require('@nestjs/testing');
const { SwaggerModule, DocumentBuilder } = require('@nestjs/swagger');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const { OperationsController } = require('../dist/modules/operations/operations.controller');
const { OperationsService } = require('../dist/modules/operations/operations.service');
const { StoreService } = require('../dist/modules/database/store.service');
const dto = require('../dist/modules/operations/dto');
const calendar = require('../dist/common/utils/business-calendar');
const { compliantMessage, renderMessage } = require('../dist/common/utils/message-template');
const { defaultJourneySteps } = require('../dist/modules/journey/default-journey');
const { smsSegments } = require('../dist/common/utils/sms-segments');
const { SendStaffMessageDto, QueryProspectsDto } = require('../dist/modules/conversations/dto');

async function run() {
  const roof = { id: 'cranbourne_kia', name: 'Cranbourne Kia', displayPhone: '(03) 5995 0000', sendHours: { start: '09:00', end: '20:00' }, closedDays: ['Sunday'] };
  const saturday = calendar.melbourneDate(2026, 10, 17, 19);
  const monday = calendar.businessHours(roof, 4, saturday);
  assert.deepEqual(calendar.localParts(monday), { year: 2026, month: 10, day: 19, hour: 12, minute: 0 });
  assert.deepEqual(calendar.localParts(calendar.nextMorning(roof, saturday)), { year: 2026, month: 10, day: 19, hour: 9, minute: 0 });
  assert.equal(calendar.melbourneDate(2026, 7, 1, 9).toISOString(), '2026-06-30T23:00:00.000Z');
  assert.equal(calendar.melbourneDate(2026, 10, 14, 9).toISOString(), '2026-10-13T22:00:00.000Z');
  assert.equal(calendar.isOpen(roof, calendar.melbourneDate(2026, 10, 14, 20)), false);
  const prospect = { customer: { firstName: 'Test' }, vehicle: {}, assignedTo: { name: 'Test Staff' } };
  const text = compliantMessage(renderMessage(defaultJourneySteps[4].template, prospect, roof), roof);
  assert.match(text, /Reply STOP/); assert.match(text, /5995/); assert.match(text, /the vehicle you enquired about/);
  assert.throws(() => compliantMessage('x'.repeat(1600), roof));
  assert.equal(smsSegments('a'.repeat(160)).segments, 1);
  assert.equal(smsSegments('['.repeat(81)).segments, 2);
  assert.equal(smsSegments('€').isUnicode, false);
  assert.equal(smsSegments('😀'.repeat(36)).segments, 2);
  assert.equal((await validate(plainToInstance(SendStaffMessageDto, { templateId: 'template-id' }))).length, 0);
  assert.ok((await validate(plainToInstance(QueryProspectsDto, { ownership: 'unknown' }))).length);
  assert.ok((await validate(plainToInstance(dto.PlatformSettingsDto, { duplicateWindowDays: -1 }))).length);
  assert.equal((await validate(plainToInstance(dto.JourneyDraftDto, { rooftopId: 'cranbourne_kia', leadType: 'new_vehicle_internet', name: 'Default', steps: defaultJourneySteps }))).length, 0);
  const fakeStore = { recordList: async () => [], getSettings: async () => ({ retentionEnabled: false }) };
  const service = new OperationsService(fakeStore);
  assert.throws(() => service.scope({ role: 'sales_manager', rooftopIds: ['cranbourne_kia'] }, 'cranbourne_mg'));
  assert.throws(() => service.validateSteps({ steps: [{ ...defaultJourneySteps[0], template: '{{unknown}}' }] }));
  const module = await Test.createTestingModule({ controllers: [OperationsController], providers: [{ provide: StoreService, useValue: {} }, { provide: OperationsService, useValue: {} }] }).compile();
  const app = module.createNestApplication({ logger: false });
  try {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().addBearerAuth().build());
    const required = {
      '/api/settings': ['get', 'patch'], '/api/rooftops/{id}': ['patch'],
      '/api/journeys': ['get', 'post'], '/api/journeys/{id}': ['patch'],
      '/api/journeys/{id}/publish': ['post'], '/api/journeys/{id}/activate': ['post'], '/api/journeys/{id}/pause': ['post'],
      '/api/templates': ['get', 'post'], '/api/templates/{id}': ['patch', 'delete'],
      '/api/prospects/{id}/consent': ['patch'], '/api/tasks': ['get'], '/api/tasks/{id}': ['patch'],
      '/api/notifications': ['get'], '/api/notifications/{id}/read': ['patch'],
      '/api/reports/journey-performance': ['get'], '/api/compliance/send-audit': ['get'],
      '/api/compliance/activity-audit': ['get'], '/api/settings/retention-preview': ['get'],
    };
    for (const [path, methods] of Object.entries(required)) for (const method of methods) assert.ok(document.paths[path]?.[method], `${method} ${path} must appear in Swagger`);
    for (const name of ['JourneyDraftDto', 'JourneyStepDto', 'PlatformSettingsDto', 'RooftopSettingsDto', 'TemplateDto', 'ConsentDto']) assert.ok(document.components.schemas[name], `${name} must have a Swagger schema`);
    console.log('Offline scope checks passed: calendar/DST, validation, footer, access rules and 22 Swagger operations. No live APIs/database were used.');
  } finally { await app.close(); }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
