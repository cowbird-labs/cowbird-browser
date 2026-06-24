import { utf8, b64encode, b64decode } from '../crypto/b64';
import { methods, methodById } from '../auth/index';
import { connectVault, verifyMount } from '../core/session';
import { normalizeAddress } from '../core/config';
import {
  initIdentity,
  changePassword,
  exportIdentity,
  importIdentity,
} from '../core/identity';
import { rotateKey, rotationCompleter } from '../core/rotation';
import { exportItems, importItems, removeDuplicateItems } from '../core/transfer';
import { loadOrganization, saveOrganization } from '../core/organization';
import type { Organization } from '../organization/index';
import { allCodecs, getCodec } from '../transfer/index';
import { hostMatches, classifySubmission } from '../autofill/match';
import type { HostLogin, SaveClass } from '../autofill/match';
import { totpCode } from '../items/totp';
import type { Content } from '../items/types';
import type { MatchSummary } from '../messaging/content';
import type { Envelope, SharedLink } from '../sharing/types';
import type {
  Api,
  DirectoryEntry,
  ItemDetail,
  ItemSummary,
  Method,
  Params,
  Result,
} from '../messaging/protocol';
import {
  buildSession,
  clearIdentity,
  disconnect,
  loadConfig,
  requireApp,
  requireSession,
  getSession,
  setIdentity,
  setSession,
  stateInfo,
  storeConfig,
  clearTokenInvalid,
} from './state';

// summary projects a decrypted item to a list row, pulling out only the fields
// the list and (later) autofill need. Favorite/label organization is layered on
// from the per-user overlay, keyed by the item's id (itemID or shareID).
function summary(
  id: string,
  content: Content,
  shared: boolean,
  org: Organization,
  ownerName?: string,
): ItemSummary {
  const base: ItemSummary = {
    id,
    type: content.kind,
    title: content.data.title,
    shared,
    favorite: org.isFavorite(id),
    labels: org.labelsOf(id),
  };
  if (ownerName) base.ownerName = ownerName;
  if (content.kind === 'login') {
    base.username = content.data.username;
    if (content.data.urls) base.urls = content.data.urls;
  }
  return base;
}

// mutateOrg loads the user's organization overlay, applies a mutation, persists
// the whole record (last-writer-wins, matching the rest of cowbird), and returns
// the mutation's result. Centralizes the read-modify-write the favorite/label
// handlers share.
async function mutateOrg<T>(fn: (org: Organization) => T): Promise<T> {
  const app = await requireApp();
  const org = await loadOrganization(app);
  const result = fn(org);
  await saveOrganization(app, org);
  return result;
}

const handlers: { [M in Method]: (params: Params<M>) => Promise<Result<M>> } = {
  async getState() {
    return stateInfo();
  },

  async getAuthMethods() {
    return methods.map((m) => ({ id: m.id, name: m.name, fields: m.fields() }));
  },

  async saveConfig(config) {
    // Canonicalize the address (default scheme to https, trim trailing slashes)
    // so a scheme-less entry actually connects rather than being misparsed.
    await storeConfig({ ...config, address: normalizeAddress(config.address) });
    return stateInfo();
  },

  async connect(values) {
    const config = await loadConfig();
    if (!config) throw new Error('not configured');
    const method = methodById(config.authMethodId);
    if (!method) throw new Error(`unknown auth method ${config.authMethodId}`);
    const validationError = method.validate(values);
    if (validationError) throw new Error(validationError);

    const session = await connectVault(config, method, values);
    await verifyMount(session);
    await setSession({
      token: session.token,
      entityID: session.entityID,
      displayName: session.displayName,
      authValues: values,
    });
    // A fresh login clears any prior token-expired state; this same handler backs
    // both first connect and the re-auth screen.
    await clearTokenInvalid();
    return stateInfo();
  },

  async unlock({ password }) {
    const config = await loadConfig();
    const record = await getSession();
    if (!config || !record) throw new Error('not connected to Vault');
    const session = buildSession(config, record);
    const identity = await initIdentity(
      session.store,
      utf8(password),
      record.displayName,
      rotationCompleter(record.displayName),
    );
    await setIdentity(identity);
    // Best-effort: drain any pending shares/revokes so the list is current.
    try {
      const app = await requireApp();
      await app.service.processInbox();
    } catch {
      // A failing inbox must not block unlock.
    }
    return stateInfo();
  },

  async lock() {
    await clearIdentity();
    return stateInfo();
  },

  async disconnect() {
    await disconnect();
    return stateInfo();
  },

  async listItems() {
    const app = await requireApp();
    const org = await loadOrganization(app);
    const items: ItemSummary[] = [];
    const liveIDs = new Set<string>();

    for (const env of await app.service.listItems()) {
      try {
        items.push(summary(env.id, await app.service.openOwnItem(env), false, org));
        liveIDs.add(env.id);
      } catch {
        // Skip items that fail to decrypt rather than breaking the whole list.
      }
    }

    const dir = await app.service.directory();
    const nameByID = new Map(dir.map((e) => [e.entityID, e.name]));
    for (const link of await app.service.listSharedLinks()) {
      try {
        const content = await app.service.openSharedItem(link);
        items.push(
          summary(link.shareID, content, true, org, nameByID.get(link.ownerID) ?? link.ownerID),
        );
        liveIDs.add(link.shareID);
      } catch {
        // Dead link (revoked or envelope gone) — skip.
      }
    }

    // Lazy cleanup: drop overlay metadata for items/shares that no longer exist
    // (deleted items, revoked shares) and persist if anything changed.
    if (org.prune(liveIDs)) {
      try {
        await saveOrganization(app, org);
      } catch {
        // A failed cleanup write is non-fatal; the list is still correct.
      }
    }
    return { items, labels: org.labels };
  },

  async getItem({ id, shared }): Promise<ItemDetail> {
    const app = await requireApp();
    const org = await loadOrganization(app);
    const overlay = { favorite: org.isFavorite(id), labels: org.labelsOf(id) };
    if (shared) {
      const link = (await app.service.listSharedLinks()).find(
        (l: SharedLink) => l.shareID === id,
      );
      if (!link) throw new Error('shared item not found');
      const content = await app.service.openSharedItem(link);
      return { id, type: content.kind, content, shared: true, ...overlay };
    }
    const env: Envelope = await app.session.store.getItem(id);
    const content = await app.service.openOwnItem(env);
    const records = await app.service.listShareRecords(id);
    const dir = await app.service.directory();
    const nameByID = new Map(dir.map((e) => [e.entityID, e.name]));
    const recipients = records.map((r) => ({
      shareID: r.shareID,
      recipientID: r.recipientID,
      recipientName: nameByID.get(r.recipientID) ?? r.recipientID,
    }));
    return { id, type: content.kind, content, shared: false, recipients, ...overlay };
  },

  async createItem({ content }) {
    const app = await requireApp();
    const env = await app.service.createItem(content);
    return { id: env.id };
  },

  async updateItem({ id, content }) {
    const app = await requireApp();
    await app.service.updateItem(id, content);
    return {};
  },

  async deleteItem({ id }) {
    const app = await requireApp();
    await app.service.deleteItem(id);
    // Drop the deleted item's favorite/label overlay so it leaves no dangling
    // organization (FR-009). Best-effort: the item itself is already gone, and
    // prune() would clean up on the next list regardless.
    try {
      const org = await loadOrganization(app);
      org.forget(id);
      await saveOrganization(app, org);
    } catch {
      // Non-fatal; lazy prune in listItems is the backstop.
    }
    return {};
  },

  async directory() {
    const app = await requireApp();
    const entries: DirectoryEntry[] = (await app.service.directory()).map((e) => ({
      entityID: e.entityID,
      name: e.name || e.entityID,
      isSelf: e.entityID === app.session.entityID,
    }));
    return { entries };
  },

  async shareItem({ itemId, recipientId }) {
    const app = await requireApp();
    await app.service.share(itemId, recipientId);
    return {};
  },

  async revokeShare({ shareId, recipientId }) {
    const app = await requireApp();
    await app.service.revoke(shareId, recipientId);
    return {};
  },

  async refreshInbox() {
    const app = await requireApp();
    await app.service.processInbox();
    return {};
  },

  async changePassword({ oldPassword, newPassword }) {
    const session = await requireSession();
    await changePassword(session.store, utf8(oldPassword), utf8(newPassword));
    return {};
  },

  async rotateKey({ password }) {
    const app = await requireApp();
    await rotateKey(app, utf8(password), app.session.displayName);
    await setIdentity(app.identity);
    return stateInfo();
  },

  async exportKey({ unlockPassword, passphrase }) {
    const session = await requireSession();
    const bytes = await exportIdentity(session.store, utf8(unlockPassword), utf8(passphrase));
    return { fileBase64: b64encode(bytes) };
  },

  async importKey({ fileText, passphrase, newPassword, force }) {
    const session = await requireSession();
    const record = await getSession();
    const identity = await importIdentity(
      session.store,
      utf8(fileText),
      utf8(passphrase),
      utf8(newPassword),
      record?.displayName ?? '',
      force,
    );
    await setIdentity(identity);
    return stateInfo();
  },

  async listLabels() {
    const app = await requireApp();
    const org = await loadOrganization(app);
    return { labels: org.labels };
  },

  async toggleFavorite({ id }) {
    return mutateOrg((org) => ({ favorite: org.toggleFavorite(id) }));
  },

  async assignLabel({ id, labelId }) {
    return mutateOrg((org) => {
      org.assignLabel(id, labelId);
      return {};
    });
  },

  async unassignLabel({ id, labelId }) {
    return mutateOrg((org) => {
      org.unassignLabel(id, labelId);
      return {};
    });
  },

  async addLabel({ name, color }) {
    return mutateOrg((org) => ({ label: org.addLabel(name, color) }));
  },

  async renameLabel({ labelId, name }) {
    return mutateOrg((org) => {
      org.renameLabel(labelId, name);
      return {};
    });
  },

  async recolorLabel({ labelId, color }) {
    return mutateOrg((org) => {
      org.recolorLabel(labelId, color);
      return {};
    });
  },

  async deleteLabel({ labelId }) {
    return mutateOrg((org) => {
      org.deleteLabel(labelId);
      return {};
    });
  },

  async listFormats() {
    return {
      formats: allCodecs().map((c) => ({ id: c.id, name: c.name, extension: c.extension })),
    };
  },

  async exportItems({ format }) {
    const app = await requireApp();
    const codec = getCodec(format);
    if (!codec) throw new Error(`unknown export format ${format}`);
    const bytes = await exportItems(app, codec);
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return { fileBase64: b64encode(bytes), filename: `cowbird-export-${stamp}${codec.extension}` };
  },

  async importItems({ format, dataBase64 }) {
    const app = await requireApp();
    const codec = getCodec(format);
    if (!codec) throw new Error(`unknown import format ${format}`);
    return importItems(app, codec, b64decode(dataBase64));
  },

  async removeDuplicates({ dryRun }) {
    const app = await requireApp();
    return { count: await removeDuplicateItems(app, dryRun) };
  },
};

// --- In-page autofill (content-script driven) ---------------------------------
// These power the on-focus menu. They are NOT part of the popup RPC `Api`; the
// background message listener calls them directly with a host derived from the
// sender frame, so everything stays scoped to the page that asked.

/**
 * matchesForHost returns the login items whose stored URLs match `host`,
 * projected to metadata only (no secrets). When the vault is locked (or not
 * connected) it reports `locked: true` and no matches — the UI then offers to
 * open the popup to unlock.
 */
export async function matchesForHost(
  host: string,
): Promise<{ locked: boolean; matches: MatchSummary[] }> {
  let app;
  try {
    app = await requireApp();
  } catch {
    return { locked: true, matches: [] };
  }
  const matches: MatchSummary[] = [];
  for (const env of await app.service.listItems()) {
    try {
      const content = await app.service.openOwnItem(env);
      if (content.kind !== 'login') continue;
      const urls = content.data.urls ?? [];
      if (urls.some((u) => hostMatches(u, host))) {
        matches.push({
          id: env.id,
          title: content.data.title,
          username: content.data.username,
          hasTotp: Boolean(content.data.totp),
        });
      }
    } catch {
      // Skip items that fail to decrypt.
    }
  }
  return { locked: false, matches };
}

/**
 * credsForItem returns the username/password for a login item, but only if one
 * of its URLs matches `host` — so a content script can never pull credentials
 * for an item unrelated to the page it runs on.
 */
export async function credsForItem(
  id: string,
  host: string,
): Promise<{ username: string; password: string }> {
  const app = await requireApp();
  const env = await app.session.store.getItem(id);
  const content = await app.service.openOwnItem(env);
  if (content.kind !== 'login') throw new Error('not a login item');
  const urls = content.data.urls ?? [];
  if (!urls.some((u) => hostMatches(u, host))) throw new Error('item does not match host');
  return { username: content.data.username ?? '', password: content.data.password ?? '' };
}

/**
 * codeForItem returns the current one-time code for a login's stored TOTP
 * secret, host-scoped like credsForItem. Only the generated code leaves the
 * worker — never the secret.
 */
export async function codeForItem(id: string, host: string): Promise<{ code: string }> {
  const app = await requireApp();
  const env = await app.session.store.getItem(id);
  const content = await app.service.openOwnItem(env);
  if (content.kind !== 'login') throw new Error('not a login item');
  const urls = content.data.urls ?? [];
  if (!urls.some((u) => hostMatches(u, host))) throw new Error('item does not match host');
  if (!content.data.totp) throw new Error('no TOTP secret');
  const { code } = await totpCode(content.data.totp);
  return { code };
}

// hostLogins returns the user's own login items whose URLs match `host`,
// decrypted. Shared with the save-decision flow.
async function hostLogins(host: string): Promise<HostLogin[]> {
  const app = await requireApp();
  const out: HostLogin[] = [];
  for (const env of await app.service.listItems()) {
    try {
      const content = await app.service.openOwnItem(env);
      if (content.kind !== 'login') continue;
      const urls = content.data.urls ?? [];
      if (urls.some((u) => hostMatches(u, host))) {
        out.push({
          id: env.id,
          title: content.data.title,
          username: content.data.username ?? '',
          password: content.data.password ?? '',
        });
      }
    } catch {
      // Skip items that fail to decrypt.
    }
  }
  return out;
}

/**
 * decideSave inspects a freshly-submitted credential against the host's existing
 * logins and reports whether to offer a save, an update, or nothing. Throws when
 * the vault is locked / not connected (the caller maps that to a "locked" offer).
 */
export async function decideSave(
  host: string,
  username: string,
  password: string,
): Promise<SaveClass> {
  return classifySubmission(await hostLogins(host), username, password);
}

/**
 * saveCredential persists a captured credential. `save` creates a new login
 * titled after the host with the page's origin as its URL; `update` changes the
 * password (and fills an empty username) on an existing login, after re-checking
 * that the item's URL still matches the sender's host. Host/origin are derived
 * from the sender frame, never supplied by the page.
 */
export async function saveCredential(
  origin: string,
  host: string,
  action: 'save' | 'update',
  id: string | undefined,
  username: string,
  password: string,
): Promise<void> {
  const app = await requireApp();
  if (action === 'save') {
    await app.service.createItem({
      kind: 'login',
      data: { title: host, username, password, urls: [origin] },
    });
    return;
  }
  if (!id) throw new Error('update requires an item id');
  const env = await app.session.store.getItem(id);
  const content = await app.service.openOwnItem(env);
  if (content.kind !== 'login') throw new Error('not a login item');
  const urls = content.data.urls ?? [];
  if (!urls.some((u) => hostMatches(u, host))) throw new Error('item does not match host');
  content.data.password = password;
  if (!content.data.username?.trim()) content.data.username = username;
  await app.service.updateItem(id, content);
}

/** dispatch routes a decoded RPC request to its handler. */
export function dispatch(method: Method, params: unknown): Promise<unknown> {
  const handler = handlers[method] as ((p: unknown) => Promise<unknown>) | undefined;
  if (!handler) throw new Error(`unknown method ${method}`);
  return handler(params);
}

export type { Api };
