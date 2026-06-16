import { TOTP } from 'totp-generator';

// TOTP code generation, shared by the popup (live code display) and the
// background worker (autofilling one-time-code prompts — the secret stays in the
// worker, only the generated code leaves). Mirrors the desktop app's totpNow
// (internal/ui/detail.go): RFC 6238 defaults (SHA-1, 6 digits, 30s period),
// internal spaces stripped, codes zero-padded to a fixed width. The library
// uppercases and strips base32 padding itself; explicitZeroPad keeps short codes
// at 6 digits so they match the Go output. Runs in any secure context with
// crypto.subtle (popup + service worker).

export const TOTP_PERIOD = 30;

export interface TotpCode {
  code: string;
  /** Whole seconds left in the current period. */
  remaining: number;
}

export async function totpCode(secret: string): Promise<TotpCode> {
  const cleaned = secret.replace(/ /g, '');
  if (!cleaned) throw new Error('empty TOTP secret');
  const now = Date.now();
  const { otp, expires } = await TOTP.generate(cleaned, {
    timestamp: now,
    explicitZeroPad: true,
  });
  return { code: otp, remaining: Math.max(0, Math.ceil((expires - now) / 1000)) };
}
