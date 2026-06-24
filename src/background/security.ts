import browser from 'webextension-polyfill';
import { loadSecuritySettings } from '../settings/security';
import { clearClipboardViaDom } from './clipboardDom';
import { clearIdentity, isUnlocked } from './state';

// Enforces the user's security preferences from the worker: an inactivity
// auto-lock (via chrome.alarms, so it survives service-worker restarts) and
// clipboard clearing after a copy. Mirrors the desktop app's autolock.go.

const AUTOLOCK_ALARM = 'cowbird:autolock';

// --- auto-lock ---------------------------------------------------------------

/** armAutoLock (re)schedules the inactivity lock from the current settings.
 * A disabled or non-positive timeout clears any pending alarm. */
export async function armAutoLock(): Promise<void> {
  const s = await loadSecuritySettings();
  await browser.alarms.clear(AUTOLOCK_ALARM);
  if (s.autoLock && s.autoLockMinutes > 0) {
    browser.alarms.create(AUTOLOCK_ALARM, { delayInMinutes: s.autoLockMinutes });
  }
}

/** disarmAutoLock cancels the pending lock (on explicit lock/disconnect). */
export async function disarmAutoLock(): Promise<void> {
  await browser.alarms.clear(AUTOLOCK_ALARM);
}

/** noteActivity resets the inactivity countdown. Called on each popup
 * interaction; a no-op while locked or when auto-lock is disabled. */
export async function noteActivity(): Promise<void> {
  if (!(await isUnlocked())) return;
  await armAutoLock();
}

/** registerSecurity wires the auto-lock alarm listener. Call once at startup. */
export function registerSecurity(): void {
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== AUTOLOCK_ALARM) return;
    void (async () => {
      await clearIdentity();
      // Don't leave a secret Cowbird copied sitting on the clipboard after a lock.
      await clearClipboardNow();
    })();
  });
}

// --- clipboard clearing ------------------------------------------------------

let clipTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * armClipboardClear schedules wiping the clipboard the configured number of
 * seconds after a copy (resetting any prior timer so only the latest copy is
 * pending). No-op when disabled. Survives the popup closing: on Firefox the
 * persistent background page clears directly; on Chrome the worker spins up an
 * offscreen document to do it (see clearClipboardNow).
 */
export async function armClipboardClear(): Promise<void> {
  const s = await loadSecuritySettings();
  if (clipTimer) {
    clearTimeout(clipTimer);
    clipTimer = null;
  }
  if (!s.clipboardClear || s.clipboardClearSeconds <= 0) return;
  clipTimer = setTimeout(() => {
    clipTimer = null;
    void clearClipboardNow();
  }, s.clipboardClearSeconds * 1000);
}

/**
 * clearClipboardNow wipes the clipboard. Only a DOM-bearing extension context
 * with clipboardWrite can do this without a user gesture: Firefox's background
 * page directly, Chrome's service worker via an offscreen document. Best-effort.
 */
export async function clearClipboardNow(): Promise<void> {
  try {
    if (typeof document !== 'undefined') {
      clearClipboardViaDom(); // Firefox persistent background page
      return;
    }
    await clearClipboardViaOffscreen(); // Chrome MV3 service worker
  } catch {
    // Clipboard may be unavailable; nothing else to do.
  }
}

interface OffscreenApi {
  createDocument(opts: { url: string; reasons: string[]; justification: string }): Promise<void>;
  closeDocument(): Promise<void>;
}

function offscreenApi(): OffscreenApi | undefined {
  return (globalThis as unknown as { chrome?: { offscreen?: OffscreenApi } }).chrome?.offscreen;
}

// clearClipboardViaOffscreen creates a transient Chrome offscreen document, asks
// it to clear the clipboard, then closes it. No-op on browsers without the API.
async function clearClipboardViaOffscreen(): Promise<void> {
  const off = offscreenApi();
  if (!off) return;
  try {
    try {
      await off.createDocument({
        url: 'offscreen.html',
        reasons: ['CLIPBOARD'],
        justification: 'Clear the clipboard after the configured delay.',
      });
    } catch {
      // A document may already exist (a prior clear still closing) — reuse it.
    }
    await browser.runtime.sendMessage({ target: 'offscreen', type: 'cowbird:clearClipboard' });
  } finally {
    try {
      await off.closeDocument();
    } catch {
      // Nothing to close, or already closed.
    }
  }
}
