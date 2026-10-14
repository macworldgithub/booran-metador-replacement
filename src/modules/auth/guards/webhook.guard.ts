import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import twilio = require('twilio');

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
    if (['/api/leads/ingest', '/api/leads/ingest-adf'].includes(path)) {
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
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const base = process.env.WEBHOOK_PUBLIC_BASE_URL;
      if (!authToken || !base)
        throw new ServiceUnavailableException(
          'Carrier webhook signature verification is not configured',
        );
      const signature = request.headers['x-twilio-signature'];
      const url = `${base.replace(/\/$/, '')}${request.originalUrl}`;
      if (
        typeof signature !== 'string' ||
        !twilio.validateRequest(authToken, signature, url, request.body ?? {})
      )
        throw new UnauthorizedException('Invalid carrier signature');
    }
    return true;
  }
}
