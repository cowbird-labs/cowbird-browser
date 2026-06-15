import { utf8, b64encode } from '../crypto/b64';
import { methods, methodById } from '../auth/index';
import { connectVault, verifyMount } from '../core/session';
import {
  initIdentity,
  changePassword,
  exportIdentity,
  importIdentity,
} from '../core/identity';
import { rotateKey, rotationCompleter } from '../core/rotation';
import type { Content } from '../items/types';
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
} from './state';

// summary projects a decrypted item to a list row, pulling out only the fields
// the list and (later) autofill need.
function summary(id: string, content: Content, shared: boolean, ownerName?: string): ItemSummary {
  const base: ItemSummary = { id, type: content.kind, title: content.data.title, shared };
  if (ownerName) base.ownerName = ownerName;
  if (content.kind === 'login') {
    base.username = content.data.username;
    if (content.data.urls) base.urls = content.data.urls;
  }
  return base;
}

const handlers: { [M in Method]: (params: Params<M>) => Promise<Result<M>> } = {
  async getState() {
    return stateInfo();
  },

  async getAuthMethods() {
    return methods.map((m) => ({ id: m.id, name: m.name, fields: m.fields() }));
  },

  async saveConfig(config) {
    await storeConfig(config);
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
    const items: ItemSummary[] = [];

    for (const env of await app.service.listItems()) {
      try {
        items.push(summary(env.id, await app.service.openOwnItem(env), false));
      } catch {
        // Skip items that fail to decrypt rather than breaking the whole list.
      }
    }

    const dir = await app.service.directory();
    const nameByID = new Map(dir.map((e) => [e.entityID, e.name]));
    for (const link of await app.service.listSharedLinks()) {
      try {
        const content = await app.service.openSharedItem(link);
        items.push(summary(link.shareID, content, true, nameByID.get(link.ownerID) ?? link.ownerID));
      } catch {
        // Dead link (revoked or envelope gone) — skip.
      }
    }
    return { items };
  },

  async getItem({ id, shared }): Promise<ItemDetail> {
    const app = await requireApp();
    if (shared) {
      const link = (await app.service.listSharedLinks()).find(
        (l: SharedLink) => l.shareID === id,
      );
      if (!link) throw new Error('shared item not found');
      const content = await app.service.openSharedItem(link);
      return { id, type: content.kind, content, shared: true };
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
    return { id, type: content.kind, content, shared: false, recipients };
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
};

/** dispatch routes a decoded RPC request to its handler. */
export function dispatch(method: Method, params: unknown): Promise<unknown> {
  const handler = handlers[method] as ((p: unknown) => Promise<unknown>) | undefined;
  if (!handler) throw new Error(`unknown method ${method}`);
  return handler(params);
}

export type { Api };
