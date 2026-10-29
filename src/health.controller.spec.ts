import { ServiceUnavailableException } from '@nestjs/common';
import { Connection } from 'mongoose';
import { HealthController } from './health.controller';

// The unit test supplies its connection directly; avoid loading the ESM adapter
// through Jest 29's CommonJS runtime. Production uses Node 24's ESM interop.
jest.mock('@nestjs/mongoose', () => ({ InjectConnection: () => () => undefined }));

describe('HealthController', () => {
  it('reports healthy only after the database responds', async () => {
    const ping = jest.fn().mockResolvedValue({ ok: 1 });
    const connection = { readyState: 1, db: { admin: () => ({ ping }) } };
    const controller = new HealthController(connection as unknown as Connection);
    await expect(controller.health()).resolves.toEqual({ status: 'ok' });
  });

  it('returns unavailable when the connection is closed', async () => {
    const controller = new HealthController({ readyState: 0 } as Connection);
    await expect(controller.health()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('does not expose database errors to health callers', async () => {
    const ping = jest.fn().mockRejectedValue(new Error('sensitive upstream URI'));
    const connection = { readyState: 1, db: { admin: () => ({ ping }) } };
    const controller = new HealthController(connection as unknown as Connection);
    await expect(controller.health()).rejects.toThrow('Database unavailable');
  });
});
