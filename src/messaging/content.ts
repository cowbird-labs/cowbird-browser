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
