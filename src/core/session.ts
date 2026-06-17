import type { AuthMethod } from '../auth/types';
import { VaultHttp } from '../vault/http';
import { HttpKv } from '../vault/httpkv';
import { VaultStore } from '../vault/store';
import type { VaultConfig } from './config';

// Mirrors vault.NewVault, minus the desktop keyring and the background renewal
// goroutine. Token renewal lives in the background worker (src/background/reauth.ts),
// which refreshes the token reactively when a Vault call reports it expired.

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
