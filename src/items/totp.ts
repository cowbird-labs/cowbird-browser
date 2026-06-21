import { TOTP } from 'totp-generator';

// TOTP code generation, shared by the popup (live code display) and the
// background worker (autofilling one-time-code prompts — the secret stays in the
// worker, only the generated code leaves). Mirrors the desktop app's totpNow
// (internal/ui/detail.go): a stored value may be a bare base32 secret (RFC 6238
// defaults: SHA-1, 6 digits, 30s period) OR a full otpauth:// URI (the form
// other password managers export), whose secret and period/digits/algorithm
// parameters are honored so non-default configurations render correctly.
// Internal spaces (common in grouped secrets) are stripped; the library
// uppercases and strips base32 padding itself; explicitZeroPad keeps short codes
// at full width so they match the Go output. Runs in any context the library
// supports (popup + service worker).

export const TOTP_PERIOD = 30;

export interface TotpCode {
  code: string;
  /** Whole seconds left in the current period. */
  remaining: number;
}

// The algorithm names totp-generator accepts. otpauth URIs spell them without
// the dash (SHA1/SHA256/SHA512); mapAlgorithm bridges the two.
type ShaAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-512';

interface TotpParams {
  secret: string;
  period: number;
  digits: number;
  algorithm: ShaAlgorithm;
}

function mapAlgorithm(alg: string): ShaAlgorithm {
  switch (alg.toUpperCase()) {
    case 'SHA256':
    case 'SHA-256':
      return 'SHA-256';
    case 'SHA512':
    case 'SHA-512':
      return 'SHA-512';
    default:
      return 'SHA-1';
  }
}

// parseOtpauth extracts the secret and parameters from an otpauth://totp/ URI.
// Missing or invalid parameters fall back to the RFC 6238 defaults.
function parseOtpauth(value: string): TotpParams {
  const url = new URL(value);
  const secret = url.searchParams.get('secret') ?? '';
  if (!secret) throw new Error('otpauth URI missing secret');
  const period = Number.parseInt(url.searchParams.get('period') ?? '', 10);
  const digits = Number.parseInt(url.searchParams.get('digits') ?? '', 10);
  return {
    secret,
    period: period > 0 ? period : TOTP_PERIOD,
    digits: digits > 0 ? digits : 6,
    algorithm: mapAlgorithm(url.searchParams.get('algorithm') ?? ''),
  };
}

export async function totpCode(secret: string): Promise<TotpCode> {
  const value = secret.trim();
  if (!value) throw new Error('empty TOTP secret');
  const now = Date.now();

  const opts: {
    timestamp: number;
    explicitZeroPad: boolean;
    period?: number;
    digits?: number;
    algorithm?: ShaAlgorithm;
  } = { timestamp: now, explicitZeroPad: true };

  let key: string;
  if (value.toLowerCase().startsWith('otpauth://')) {
    const p = parseOtpauth(value);
    key = p.secret.replace(/ /g, '');
    opts.period = p.period;
    opts.digits = p.digits;
    opts.algorithm = p.algorithm;
  } else {
    key = value.replace(/ /g, '');
  }

  const { otp, expires } = await TOTP.generate(key, opts);
  return { code: otp, remaining: Math.max(0, Math.ceil((expires - now) / 1000)) };
}
