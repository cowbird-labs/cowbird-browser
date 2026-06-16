// Popup-facing TOTP helpers. Code generation lives in ../items/totp (shared with
// the worker); this module keeps the UI-only display helper and re-exports the
// generator under the name the detail view already uses.

export { TOTP_PERIOD, totpCode as totpNow } from '../items/totp';
export type { TotpCode } from '../items/totp';

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
