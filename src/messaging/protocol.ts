import type { VaultConfig } from '../core/config';
import type { AuthField } from '../auth/types';
import type { Content, ItemType } from '../items/types';
import type { Label } from '../organization/index';

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
  favorite: boolean; // private per-user organization overlay
  labels: string[]; // assigned label IDs (resolve against the label set)
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
  favorite: boolean; // private per-user organization overlay
  labels: string[]; // assigned label IDs
}

export interface DirectoryEntry {
  entityID: string;
  name: string;
  isSelf: boolean;
}

/** A selectable import/export file format (one transfer codec). */
export interface TransferFormat {
  id: string;
  name: string;
  extension: string;
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

  listItems(): { items: ItemSummary[]; labels: Label[] };
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

  // Organization overlay (favorites + labels), private per user.
  listLabels(): { labels: Label[] };
  toggleFavorite(args: { id: string }): { favorite: boolean };
  assignLabel(args: { id: string; labelId: string }): Record<string, never>;
  unassignLabel(args: { id: string; labelId: string }): Record<string, never>;
  addLabel(args: { name: string; color: string }): { label: Label };
  renameLabel(args: { labelId: string; name: string }): Record<string, never>;
  recolorLabel(args: { labelId: string; color: string }): Record<string, never>;
  deleteLabel(args: { labelId: string }): Record<string, never>;

  listFormats(): { formats: TransferFormat[] };
  exportItems(args: { format: string }): { fileBase64: string; filename: string };
  importItems(args: { format: string; dataBase64: string }): { imported: number; skipped: number };
  removeDuplicates(args: { dryRun: boolean }): { count: number };
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
export type { Label } from '../organization/index';
