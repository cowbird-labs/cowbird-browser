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
// `method` field rather than a `type`). Used for the in-field autofill icon,
// which asks the worker to open the toolbar popup. No page or item data crosses
// this channel.
export type BackgroundMessage = { type: 'cowbird:openPopup' };

export interface OpenPopupResponse {
  opened: boolean;
}
