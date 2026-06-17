// Messages exchanged between the popup and the per-page content script (via
// tabs.sendMessage, a separate channel from the popup<->worker RPC). The content
// script fills fields; it never sees or stores anything until the user clicks
// Fill, and the credential is passed straight through, not retained.

export type ContentMessage =
  | { type: 'cowbird:detect' }
  | { type: 'cowbird:fill'; username: string; password: string };

export interface DetectResponse {
  hasLogin: boolean;
  host: string;
}

export interface FillResponse {
  filled: boolean;
}

// Control messages sent from the content script to the background worker (via
// runtime.sendMessage, distinct from the popup<->worker RPC, which carries a
// `method` field rather than a `type`). Drive the in-page autofill menu.
//
// The worker scopes every response to the sender frame's own host: `matches`
// returns only login title/username for that host (never secrets), and
// `fillItem` re-checks the item's URL against that host before returning the
// credential. `openPopup` opens the toolbar popup (unlock / browse fallback).
export type BackgroundMessage =
  | { type: 'cowbird:openPopup' }
  | { type: 'cowbird:matches' }
  | { type: 'cowbird:fillItem'; id: string }
  | { type: 'cowbird:fillCode'; id: string }
  | { type: 'cowbird:saveDecision'; username: string; password: string }
  | {
      type: 'cowbird:saveCredential';
      action: 'save' | 'update';
      id?: string;
      username: string;
      password: string;
    };

export interface OpenPopupResponse {
  opened: boolean;
}

/** A login match for the active page — metadata only, no secrets. */
export interface MatchSummary {
  id: string;
  title: string;
  username: string;
  /** Whether this login has a TOTP secret (so a one-time code can be filled). */
  hasTotp: boolean;
}

export interface MatchesResponse {
  /** True when the vault is locked: matches can't be computed without unlock. */
  locked: boolean;
  matches: MatchSummary[];
}

export type FillItemResponse =
  | { username: string; password: string }
  | { error: string };

// The current one-time code for a login (generated in the worker from the stored
// secret; only the ephemeral code crosses to the page).
export type FillCodeResponse = { code: string } | { error: string };

// --- Save / update credential offer -------------------------------------------
// The content script captures a freshly-submitted username/password and asks the
// worker what to offer. The password crosses page → worker here (the reverse of
// fill): it's the user's own typed credential, and the worker remains the only
// side that decrypts/compares and writes to Vault. Host is derived from the
// sender frame by the worker, never supplied by the page.

/** What an offered save should do, decided by the worker for the sender's host. */
export type SaveDecisionResponse =
  | { kind: 'locked' } // vault locked / not connected — offer "unlock to save"
  | { kind: 'none' } // an identical login already exists — no offer
  | { kind: 'save' } // no matching login — offer to create one
  | { kind: 'update'; id: string; title: string }; // matching login, changed password

export type SaveCredentialResponse = { ok: true } | { error: string };
