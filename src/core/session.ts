import type { AuthMethod } from '../auth/types';
import { VaultHttp } from '../vault/http';
import { HttpKv } from '../vault/httpkv';
import { VaultStore } from '../vault/store';
import type { VaultConfig } from './config';

// Mirrors vault.NewVault, minus the desktop keyring and the background renewal
// goroutine. Token renewal scheduling belongs to the MV3 background worker
// (chrome.alarms); this module exposes renewSession for it to call.

export interface VaultSession {
  http: VaultHttp;
  store: VaultStore;
  token: string;
  entityID: string;
  displayName: string;
  mount: string;
}

/** connectVault authenticates and returns a live session bound to the entity. */
export async function connectVault(
  config: VaultConfig,
  method: AuthMethod,
  values: Record<string, string>,
): Promise<VaultSession> {
  const http = new VaultHttp(config.address, config.namespace);
  const result = await method.authenticate(http, values);
  http.token = result.token;
  const store = new VaultStore(new HttpKv(http, config.mount), result.entityID);
  return {
    http,
    store,
    token: result.token,
    entityID: result.entityID,
    displayName: result.displayName,
    mount: config.mount,
  };
}

/**
 * verifyMount confirms the configured mount is reachable with the session token.
 * A missing users/<entityID> subtree (empty list) is success: the mount works and
 * the policy grants access; only a real error (e.g. 403) propagates.
 */
export async function verifyMount(session: VaultSession): Promise<void> {
  await session.store.kv.list(`users/${session.entityID}`);
}

/** renewSession extends the token in place; the background worker calls this. */
export async function renewSession(
  session: VaultSession,
  method: AuthMethod,
  values: Record<string, string>,
): Promise<void> {
  const result = await method.renew(session.http, session.token, values);
  session.http.token = result.token;
  session.token = result.token;
  if (result.entityID) session.entityID = result.entityID;
}
