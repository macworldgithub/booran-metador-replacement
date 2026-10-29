import { OperationsService } from '../src/modules/operations/operations.service';
import { RooftopId, UserRole } from '../src/common/enums';
import { RooftopsService } from '../src/modules/rooftops/rooftops.service';

const admin: any = { id: 'admin', role: UserRole.GROUP_ADMIN, rooftopIds: Object.values(RooftopId) };
const lead = (id: string, extras: any = {}) => ({ id, dealerSocketOpportunityId: `crm-${id}`,
  rooftopId: RooftopId.CRANBOURNE_KIA, createdAt: '2026-10-28T13:30:00Z', status: 'new', ...extras });
function fixture(prospects: any[] = [], events: any[] = [], inbound: any[] = []) {
  const store: any = { queryProspects: jest.fn().mockResolvedValue(prospects), sendAudit: jest.fn().mockResolvedValue(events),
    performanceEvents: jest.fn().mockResolvedValue(inbound), recordList: jest.fn(), recordGet: jest.fn() };
  return { store, service: new OperationsService(store) };
}
describe('Reporting uses recorded activity only', () => {
  it('returns actual zero counts and unknown median when no records exist', async () => {
    const { service } = fixture();
    const report: any = await service.report({}, admin);
    expect(report.daily).toEqual([]);
    expect(report.medianFirstSmsSeconds).toBeNull();
    expect(report.rooftops.every((r: any) => r.totalLeads === 0 && r.optedOut === 0)).toBe(true);
  });
  it('excludes known handset tests while counting saved outcomes and Melbourne daily events', async () => {
    const { service, store } = fixture([lead('one', { outcome: 'appointment_requested', lastInboundAt: new Date() }),
      lead('two', { status: 'opted_out', outcome: 'wrong_number' }), lead('sms_test_handset')], [],
      [{ prospectId: 'one', type: 'customer_inbound', timestamp: '2026-10-28T14:00:00Z' }]);
    const report: any = await service.report({}, admin);
    expect(report.excludedTestRecords).toBe(1);
    expect(report.daily).toEqual([{ date: '2026-10-29', leads: 2, replies: 1 }]);
    expect(report.rooftops[0]).toMatchObject({ totalLeads: 2, replied: 1, optedOut: 1, outcomes: { appointment_requested: 1, wrong_number: 1 } });
    expect(store.performanceEvents).toHaveBeenCalledWith(['one', 'two']);
  });
  it('measures provider acceptance time and does not count merely queued or failed SMS', async () => {
    const records = ['one', 'two', 'queued'].map(id => lead(id));
    const events = [
      { prospectId: 'one', type: 'automated_outbound', timestamp: '2026-10-28T13:30:01Z', metadata: { providerAcceptedAt: '2026-10-28T13:30:30Z' } },
      { prospectId: 'two', type: 'automated_outbound', timestamp: '2026-10-28T13:30:01Z', metadata: { providerAcceptedAt: '2026-10-28T13:31:30Z' } },
      { prospectId: 'queued', type: 'automated_outbound', timestamp: '2026-10-28T13:30:01Z', deliveryStatus: 'failed' },
    ];
    const { service } = fixture(records, events);
    const report: any = await service.report({}, admin);
    expect(report.medianFirstSmsSeconds).toBe(60);
    expect(report.rooftops[0].medianFirstSmsSeconds).toBe(60);
    expect(report.rooftops[0].failedSends).toBe(1);
  });
  it('keeps reporting scoped to the user rooftop IDs', async () => {
    const { service, store } = fixture();
    await service.report({}, { ...admin, role: UserRole.SALES_MANAGER, rooftopIds: [RooftopId.CRANBOURNE_MG] });
    expect(store.queryProspects).toHaveBeenCalledWith({ rooftopIds: [RooftopId.CRANBOURNE_MG] });
  });
  it('returns the saved current activation state, independently of published history', async () => {
    const { service, store } = fixture();
    store.recordList.mockResolvedValue([{ key: 'old', data: { rooftopId: 'cranbourne_kia', leadType: 'new' } },
      { key: 'current', data: { rooftopId: 'cranbourne_kia', leadType: 'new' } }]);
    store.recordGet.mockResolvedValue({ data: { id: 'current', enabled: false } });
    const result = await service.journeys(admin);
    expect(result[0].data).toMatchObject({ isCurrent: false, enabled: false });
    expect(result[1].data).toMatchObject({ isCurrent: true, enabled: false });
  });
  it('shows test-only SMS configuration without returning provider credentials', async () => {
    const names = ['MOBILEMESSAGE_ENABLED', 'MOBILEMESSAGE_API_USERNAME', 'MOBILEMESSAGE_API_PASSWORD', 'MOBILEMESSAGE_TEST_RECIPIENT', 'SMS_KIA_NUMBER'];
    const previous = names.map(name => process.env[name]);
    try {
      Object.assign(process.env, { MOBILEMESSAGE_ENABLED: 'true', MOBILEMESSAGE_API_USERNAME: 'fixture-user', MOBILEMESSAGE_API_PASSWORD: 'fixture-password', MOBILEMESSAGE_TEST_RECIPIENT: '+61400000000', SMS_KIA_NUMBER: '+61411111111' });
      const store: any = { refreshRooftops: jest.fn(), getRooftops: () => [{ id: RooftopId.CRANBOURNE_KIA, senderPhone: '+61422222222' }, { id: RooftopId.CRANBOURNE_MG, senderPhone: '' }] };
      const result = await new RooftopsService(store).getAllRooftops();
      expect(result[0]).toMatchObject({ smsMode: 'test_only', senderPhone: '+61411111111' });
      expect(result[1]).toMatchObject({ smsMode: 'disabled' });
      expect(JSON.stringify(result)).not.toContain('fixture-password');
    } finally {
      names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; });
    }
  });
});
