import browser from 'webextension-polyfill';
import { b64encode, b64decode } from '../crypto/b64';
import { identityFromPrivateKeys, type Identity } from '../crypto/identity';
import { VaultHttp } from '../vault/http';
import { HttpKv } from '../vault/httpkv';
import { VaultStore } from '../vault/store';
import { App } from '../core/app';
import type { VaultConfig } from '../core/config';
import type { VaultSession } from '../core/session';
import type { Phase, StateInfo } from '../messaging/protocol';

// Background-worker state. Non-secret config lives in storage.local; the Vault
// token, auth credentials, and the unlocked private keys live in storage.session
// — in-memory only, cleared when the browser closes, never written to disk. This
// lets the worker rehydrate an unlocked session across MV3 service-worker
// restarts within a browsing session, while a browser restart forces re-unlock.

const CONFIG_KEY = 'config';
const SESSION_KEY = 'session';
const IDENTITY_KEY = 'identity';
// Set when the Vault token is known-dead and silent renewal failed, so the popup
// routes to a re-auth screen. Lives in session memory alongside the token.
const TOKEN_INVALID_KEY = 'tokenInvalid';

interface SessionRecord {
  token: string;
  entityID: string;
  displayName: string;
  /** Vault auth values, retained in session memory to allow token renewal. */
  authValues: Record<string, string>;
}

interface IdentityRecord {
  encPriv: string; // base64 X25519 private key
  sigPriv: string; // base64 Ed25519 private key
}

// storage.session is part of MV3 but missing from some polyfill type defs.
const sessionStore = browser.storage.session as unknown as {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
};

export async function loadConfig(): Promise<VaultConfig | null> {
  const r = await browser.storage.local.get(CONFIG_KEY);
  return (r[CONFIG_KEY] as VaultConfig | undefined) ?? null;
}

export async function storeConfig(config: VaultConfig): Promise<void> {
  await browser.storage.local.set({ [CONFIG_KEY]: config });
}

export async function getSession(): Promise<SessionRecord | null> {
  const r = await sessionStore.get(SESSION_KEY);
  return (r[SESSION_KEY] as SessionRecord | undefined) ?? null;
}

export async function setSession(record: SessionRecord): Promise<void> {
  await sessionStore.set({ [SESSION_KEY]: record });
}

export async function getTokenInvalid(): Promise<boolean> {
  const r = await sessionStore.get(TOKEN_INVALID_KEY);
  return r[TOKEN_INVALID_KEY] === true;
}

export async function setTokenInvalid(): Promise<void> {
  await sessionStore.set({ [TOKEN_INVALID_KEY]: true });
}

export async function clearTokenInvalid(): Promise<void> {
  await sessionStore.remove(TOKEN_INVALID_KEY);
}

async function getIdentityRecord(): Promise<IdentityRecord | null> {
  const r = await sessionStore.get(IDENTITY_KEY);
  return (r[IDENTITY_KEY] as IdentityRecord | undefined) ?? null;
}

export async function setIdentity(identity: Identity): Promise<void> {
  const record: IdentityRecord = {
    encPriv: b64encode(identity.encryptionPriv),
    sigPriv: b64encode(identity.signingPriv),
  };
  await sessionStore.set({ [IDENTITY_KEY]: record });
}

export async function clearIdentity(): Promise<void> {
  await sessionStore.remove(IDENTITY_KEY);
}

export async function disconnect(): Promise<void> {
  await sessionStore.remove([SESSION_KEY, IDENTITY_KEY, TOKEN_INVALID_KEY]);
}

/** buildSession reconstructs a live VaultSession from config + the stored record. */
export function buildSession(config: VaultConfig, record: SessionRecord): VaultSession {
  const http = new VaultHttp(config.address, config.namespace);
  http.token = record.token;
  const store = new VaultStore(new HttpKv(http, config.mount), record.entityID);
  return {
    http,
    store,
    token: record.token,
    entityID: record.entityID,
    displayName: record.displayName,
    mount: config.mount,
  };
}

/** requireSession returns the live session, or throws if not connected. */
export async function requireSession(): Promise<VaultSession> {
  const config = await loadConfig();
  if (!config) throw new Error('not configured');
  const record = await getSession();
  if (!record) throw new Error('not connected to Vault');
  return buildSession(config, record);
}

/** requireApp returns the unlocked App, or throws if locked/not connected. */
export async function requireApp(): Promise<App> {
  const session = await requireSession();
  const idRecord = await getIdentityRecord();
  if (!idRecord) throw new Error('locked');
  const identity = identityFromPrivateKeys(b64decode(idRecord.encPriv), b64decode(idRecord.sigPriv));
  return new App(session, identity);
}

async function currentPhase(): Promise<Phase> {
  if (!(await loadConfig())) return 'needs-config';
  if (!(await getSession())) return 'needs-connect';
  // A dead token outranks 'locked': unlocking itself reads from Vault, so the
  // user must refresh the session before they can unlock.
  if (await getTokenInvalid()) return 'needs-reauth';
  if (!(await getIdentityRecord())) return 'locked';
  return 'unlocked';
}

/** stateInfo summarizes the worker state for the UI to route on. */
export async function stateInfo(): Promise<StateInfo> {
  const [config, phase, record] = await Promise.all([loadConfig(), currentPhase(), getSession()]);
  return {
    phase,
    config,
    displayName: record?.displayName,
    entityID: record?.entityID,
  };
}
