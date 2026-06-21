import browser from 'webextension-polyfill';
import type { PasswordOpts, PassphraseOpts } from '../generate';

// Last-used generator settings, persisted in storage.local so the generator
// reopens with the user's preferred mode and options (spec 010 FR-008). Mirrors
// how the desktop app persists generator settings in its TOML config.

export type GenMode = 'password' | 'passphrase';

export interface GeneratorSettings {
  mode: GenMode;
  password: PasswordOpts;
  passphrase: PassphraseOpts;
}

export const DEFAULT_SETTINGS: GeneratorSettings = {
  mode: 'password',
  password: { length: 20, lower: true, upper: true, digits: true, symbols: true, excludeAmbiguous: false },
  passphrase: { words: 5, separator: '-', capitalize: false, includeNumber: false },
};

const KEY = 'cowbird.generator';

export async function loadSettings(): Promise<GeneratorSettings> {
  try {
    const got = await browser.storage.local.get(KEY);
    const s = got[KEY] as Partial<GeneratorSettings> | undefined;
    if (!s) return DEFAULT_SETTINGS;
    return {
      mode: s.mode === 'passphrase' ? 'passphrase' : 'password',
      password: { ...DEFAULT_SETTINGS.password, ...s.password },
      passphrase: { ...DEFAULT_SETTINGS.passphrase, ...s.passphrase },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(s: GeneratorSettings): Promise<void> {
  try {
    await browser.storage.local.set({ [KEY]: s });
  } catch {
    // Persistence is best-effort; a failure must not break generation.
  }
}
