import type { VaultConfig } from '../core/config';
import type { AuthField } from '../auth/types';
import type { Content, ItemType } from '../items/types';

// The typed RPC contract between the popup UI and the background service worker.
// All payloads are JSON-serializable: the worker holds the keys and returns only
// already-decrypted, plain data to the (same-origin, trusted) extension UI.

export type Phase = 'needs-config' | 'needs-connect' | 'needs-reauth' | 'locked' | 'unlocked';

export interface StateInfo {
  phase: Phase;
  config: VaultConfig | null;
  displayName?: string;
  entityID?: string;
}

export interface AuthMethodInfo {
  id: string;
  name: string;
  fields: AuthField[];
}

/** A row in the item list. Sensitive fields are intentionally omitted here. */
export interface ItemSummary {
  id: string; // item id (owned) or share id (shared)
  type: ItemType;
  title: string;
  username?: string;
  urls?: string[];
  shared: boolean; // true = shared with me; false = owned by me
  ownerName?: string; // for shared items
}

export interface ShareRecipient {
  shareID: string;
  recipientID: string;
  recipientName: string;
}

export interface ItemDetail {
  id: string;
  type: ItemType;
  content: Content;
  shared: boolean;
  recipients?: ShareRecipient[]; // owned items only: who it is shared with
}

export interface DirectoryEntry {
  entityID: string;
  name: string;
  isSelf: boolean;
}

/** The full set of operations the worker exposes. Keys are method names. */
export interface Api {
  getState(): StateInfo;
  getAuthMethods(): AuthMethodInfo[];
  saveConfig(config: VaultConfig): StateInfo;
  connect(values: Record<string, string>): StateInfo;
  unlock(args: { password: string }): StateInfo;
  lock(): StateInfo;
  disconnect(): StateInfo;

  listItems(): { items: ItemSummary[] };
  getItem(args: { id: string; shared: boolean }): ItemDetail;
  createItem(args: { content: Content }): { id: string };
  updateItem(args: { id: string; content: Content }): Record<string, never>;
  deleteItem(args: { id: string }): Record<string, never>;

  directory(): { entries: DirectoryEntry[] };
  shareItem(args: { itemId: string; recipientId: string }): Record<string, never>;
  revokeShare(args: { shareId: string; recipientId: string }): Record<string, never>;
  refreshInbox(): Record<string, never>;

  changePassword(args: { oldPassword: string; newPassword: string }): Record<string, never>;
  rotateKey(args: { password: string }): StateInfo;
  exportKey(args: { unlockPassword: string; passphrase: string }): { fileBase64: string };
  importKey(args: {
    fileText: string;
    passphrase: string;
    newPassword: string;
    force: boolean;
  }): StateInfo;
}

export type Method = keyof Api;
export type Params<M extends Method> = Parameters<Api[M]>[0];
export type Result<M extends Method> = ReturnType<Api[M]>;

/** Wire envelope for a request and its response. */
export interface RpcRequest {
  method: Method;
  params?: unknown;
}

export type RpcResponse =
  | { ok: true; result: unknown }
  | { ok: false; error: string; reauth?: true };

export type { VaultConfig } from '../core/config';
export type { Content, ItemType } from '../items/types';
