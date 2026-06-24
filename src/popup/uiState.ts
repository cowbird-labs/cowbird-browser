import browser from 'webextension-polyfill';

// Last popup navigation state, persisted in storage.session so reopening the
// popup returns to the screen the user was on rather than the default list
// (issue #8). storage.session is in-memory only: it survives popup close/reopen
// and service-worker restarts within a browsing session, but a browser restart
// starts fresh. That matches the unlocked-session lifecycle and keeps "which
// item I was viewing" off disk — the same reasoning as the session token and
// unlocked keys in background/state.ts.

export type PopupView =
  | { kind: 'list' }
  | { kind: 'detail'; id: string; shared: boolean }
  | { kind: 'new' }
  | { kind: 'generator' }
  | { kind: 'labels' }
  | { kind: 'settings' };

export interface PopupUiState {
  view: PopupView;
  search: string;
}

const DEFAULT_UI_STATE: PopupUiState = { view: { kind: 'list' }, search: '' };

const KEY = 'cowbird.ui';

// storage.session is part of MV3 but missing from some polyfill type defs.
const sessionStore = browser.storage.session as unknown as {
  get(keys: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string): Promise<void>;
};

export async function loadUiState(): Promise<PopupUiState> {
  try {
    const got = await sessionStore.get(KEY);
    const s = got[KEY] as Partial<PopupUiState> | undefined;
    if (!s) return DEFAULT_UI_STATE;
    return { view: s.view ?? DEFAULT_UI_STATE.view, search: s.search ?? '' };
  } catch {
    return DEFAULT_UI_STATE;
  }
}

export async function saveUiState(s: PopupUiState): Promise<void> {
  try {
    await sessionStore.set({ [KEY]: s });
  } catch {
    // Persistence is best-effort; a failure must not break navigation.
  }
}
