import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { PhoneNormalizer } from '../../common/utils/phone-normalizer.util';

export class MobileMessageError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

@Injectable()
export class MobileMessageService {
  async send(payload: object, key: string): Promise<string> {
    if (process.env.MOBILEMESSAGE_ENABLED !== 'true')
      throw new MobileMessageError('Mobile Message sending is disabled');
    const testRecipient = process.env.MOBILEMESSAGE_TEST_RECIPIENT;
    if (testRecipient) {
      const allowed =
        PhoneNormalizer.normalizeAustralianPhone(testRecipient).normalized;
      const messages = (payload as { messages?: Array<{ to?: string }> })
        .messages;
      if (
        !allowed ||
        !Array.isArray(messages) ||
        messages.length !== 1 ||
        PhoneNormalizer.normalizeAustralianPhone(messages[0]?.to ?? '')
          .normalized !== allowed
      )
        throw new MobileMessageError(
          'SMS test mode only allows the configured test recipient',
        );
    }
    const username = process.env.MOBILEMESSAGE_API_USERNAME;
    const password = process.env.MOBILEMESSAGE_API_PASSWORD;
    if (!username || !password)
      throw new MobileMessageError(
        'Mobile Message API credentials are not configured',
      );
    if (
      process.env.NODE_ENV === 'production' &&
      !process.env.MOBILEMESSAGE_WEBHOOK_SECRET
    )
      throw new MobileMessageError(
        'Mobile Message webhook signing must be configured before production sending',
      );
    try {
      const response = await axios.post(
        'https://api.mobilemessage.com.au/v1/messages',
        payload,
        {
          auth: { username, password },
          timeout: 15000,
          headers: { 'Idempotency-Key': key },
          maxRedirects: 0,
        },
      );
      const result = response.data?.results?.[0];
      if (result?.status === 'success' && typeof result.message_id === 'string')
        return result.message_id;
      if (result && ['blocked', 'error'].includes(result.status))
        throw new MobileMessageError(
          'Mobile Message rejected this message; check sender, credits and provider suppression',
        );
      throw new MobileMessageError(
        'Unrecognised Mobile Message response; acceptance is uncertain',
        true,
      );
    } catch (error) {
      if (error instanceof MobileMessageError) throw error;
      const status = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      throw new MobileMessageError(
        status
          ? `Mobile Message request failed (HTTP ${status})`
          : 'Mobile Message connection failed; acceptance is uncertain',
        !status || status >= 500 || [408, 409, 429].includes(status),
      );
    }
  }
}
