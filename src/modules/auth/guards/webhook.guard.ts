import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { timingSafeEqual, createHmac } from 'crypto';

function equals(actual: unknown, expected: string) {
  if (typeof actual !== 'string') return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
@Injectable()
export class WebhookGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const path = request.path.replace(/\/$/, '');
    if (
      [
        '/api/leads/ingest',
        '/api/leads/ingest-adf',
        '/api/leads/connector-heartbeat',
      ].includes(path)
    ) {
      const secret = process.env.LEAD_FORWARD_SECRET;
      if (!secret)
        throw new ServiceUnavailableException(
          'Lead forwarding authentication is not configured',
        );
      if (!equals(request.headers['x-lead-forward-token'], secret))
        throw new UnauthorizedException('Invalid lead-forward token');
    }
    if (['/api/sms/inbound', '/api/sms/delivery-receipt'].includes(path)) {
      const sandboxToken = process.env.WEBHOOK_TEST_TOKEN;
      if (
        process.env.NODE_ENV !== 'production' &&
        sandboxToken &&
        equals(request.headers['x-webhook-test-token'], sandboxToken)
      )
        return true;
      const secret = process.env.MOBILEMESSAGE_WEBHOOK_SECRET;
      if (!secret)
        throw new ServiceUnavailableException(
          'Mobile Message webhook signing is not configured',
        );
      const timestamp = request.headers['x-mm-timestamp'];
      const signature = request.headers['x-mm-signature'];
      if (
        typeof timestamp !== 'string' ||
        !/^\d+$/.test(timestamp) ||
        Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
        typeof signature !== 'string' ||
        !/^[a-f0-9]{64}$/.test(signature) ||
        !Buffer.isBuffer(request.rawBody)
      )
        throw new UnauthorizedException(
          'Invalid Mobile Message signature or timestamp',
        );
      const expected = createHmac('sha256', secret)
        .update(timestamp + '.')
        .update(request.rawBody)
        .digest('hex');
      if (!equals(signature, expected))
        throw new UnauthorizedException('Invalid Mobile Message signature');
    }
    return true;
  }
}
