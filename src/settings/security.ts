import browser from 'webextension-polyfill';

// Security preferences shared by the popup (Settings UI) and the background
// worker (which enforces them). Persisted in storage.local. Mirrors the desktop
// app's config.UI auto-lock / clipboard-clear fields and their defaults.

export interface SecuritySettings {
  /** Lock the vault after this many minutes of inactivity (when enabled). */
  autoLock: boolean;
  autoLockMinutes: number;
  /** Wipe the clipboard this many seconds after Cowbird copies to it (when enabled). */
  clipboardClear: boolean;
  clipboardClearSeconds: number;
}

export const DEFAULT_SECURITY_SETTINGS: SecuritySettings = {
  autoLock: true,
  autoLockMinutes: 15,
  clipboardClear: true,
  clipboardClearSeconds: 30,
};

const KEY = 'cowbird.security';

function clampInt(v: unknown, min: number, fallback: number): number {
  const n = typeof v === 'number' ? Math.floor(v) : NaN;
  return Number.isFinite(n) && n >= min ? n : fallback;
}

/** normalize coerces a possibly-partial stored object to valid settings,
 * clamping the numeric fields to sane minimums. */
export function normalizeSecuritySettings(s: Partial<SecuritySettings> | undefined): SecuritySettings {
  if (!s) return DEFAULT_SECURITY_SETTINGS;
  return {
    autoLock: s.autoLock ?? DEFAULT_SECURITY_SETTINGS.autoLock,
    autoLockMinutes: clampInt(s.autoLockMinutes, 1, DEFAULT_SECURITY_SETTINGS.autoLockMinutes),
    clipboardClear: s.clipboardClear ?? DEFAULT_SECURITY_SETTINGS.clipboardClear,
    clipboardClearSeconds: clampInt(
      s.clipboardClearSeconds,
      1,
      DEFAULT_SECURITY_SETTINGS.clipboardClearSeconds,
    ),
  };
}

export async function loadSecuritySettings(): Promise<SecuritySettings> {
  try {
    const got = await browser.storage.local.get(KEY);
    return normalizeSecuritySettings(got[KEY] as Partial<SecuritySettings> | undefined);
  } catch {
    return DEFAULT_SECURITY_SETTINGS;
  }
}

export async function saveSecuritySettings(s: SecuritySettings): Promise<void> {
  try {
    await browser.storage.local.set({ [KEY]: normalizeSecuritySettings(s) });
  } catch {
    // Persistence is best-effort.
  }
}
