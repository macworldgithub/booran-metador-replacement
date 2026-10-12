export interface PhoneNormalizationResult {
  isValid: boolean;
  isMobile: boolean;
  isLandline: boolean;
  normalized?: string; // +614xxxxxxxx
  nationalFormat?: string; // 04xx xxx xxx
  error?: string;
}

export class PhoneNormalizer {
  /**
   * Normalizes an Australian phone number to E.164 (+614XXXXXXXX).
   * Validates if it is a mobile phone (suitable for SMS) or a landline/invalid.
   */
  static normalizeAustralianPhone(rawInput: string): PhoneNormalizationResult {
    if (!rawInput || typeof rawInput !== 'string') {
      return {
        isValid: false,
        isMobile: false,
        isLandline: false,
        error: 'Phone number is empty or not a string',
      };
    }

    // Strip all non-numeric characters except leading plus
    const cleaned = rawInput.trim().replace(/[\s\-\(\)\.]/g, '');

    // Check if it starts with +61, 61, or 0
    let digits = cleaned;
    if (digits.startsWith('+61')) {
      digits = '0' + digits.substring(3);
    } else if (digits.startsWith('61') && digits.length === 11) {
      digits = '0' + digits.substring(2);
    }

    // Must be 10 digits starting with 0
    if (!/^0\d{9}$/.test(digits)) {
      return {
        isValid: false,
        isMobile: false,
        isLandline: false,
        error: `Invalid Australian phone length/format: ${rawInput}`,
      };
    }

    // Check prefix
    const prefix = digits.substring(0, 2);

    // Australian Mobile starts with 04
    if (prefix === '04') {
      const nationalFormat = `${digits.substring(0, 4)} ${digits.substring(4, 7)} ${digits.substring(7)}`;
      const e164 = `+61${digits.substring(1)}`;
      return {
        isValid: true,
        isMobile: true,
        isLandline: false,
        normalized: e164,
        nationalFormat,
      };
    }

    // Landlines (02, 03, 07, 08)
    if (['02', '03', '07', '08'].includes(prefix)) {
      const e164 = `+61${digits.substring(1)}`;
      return {
        isValid: true,
        isMobile: false,
        isLandline: true,
        normalized: e164,
        error: 'Landline number cannot receive SMS',
      };
    }

    return {
      isValid: false,
      isMobile: false,
      isLandline: false,
      error: `Unsupported Australian prefix (${prefix}): ${rawInput}`,
    };
  }

  /**
   * Checks if an incoming message is an unsubscribe keyword according to Australian Spam Act.
   */
  static isOptOutKeyword(text: string): boolean {
    if (!text) return false;
    const normalized = text.trim().toUpperCase();
    const keywords = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];
    return keywords.includes(normalized);
  }
}
