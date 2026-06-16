import { TOTP } from 'totp-generator';

// Live one-time code generation for TOTP fields, mirroring the desktop app's
// totpNow (internal/ui/detail.go): RFC 6238 defaults (SHA-1, 6 digits, 30s
// period), internal spaces stripped, codes zero-padded to a fixed width. The
// library uppercases and strips base32 padding itself; explicitZeroPad keeps
// short codes at 6 digits so they match the Go output.

export const TOTP_PERIOD = 30;

export interface TotpCode {
  code: string;
  /** Whole seconds left in the current period. */
  remaining: number;
}

export async function totpNow(secret: string): Promise<TotpCode> {
  const cleaned = secret.replace(/ /g, '');
  if (!cleaned) throw new Error('empty TOTP secret');
  const now = Date.now();
  const { otp, expires } = await TOTP.generate(cleaned, {
    timestamp: now,
    explicitZeroPad: true,
  });
  return { code: otp, remaining: Math.max(0, Math.ceil((expires - now) / 1000)) };
}

/** Insert a space every `size` characters, e.g. "123456" -> "123 456". */
export function groupDigits(s: string, size = 3): string {
  if (size <= 0 || s.length <= size) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && i % size === 0) out += ' ';
    out += s[i];
  }
  return out;
}
