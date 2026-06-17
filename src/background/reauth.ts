// Reactive Vault-token renewal. When a Vault call fails because the token expired
// ("invalid token"), we try to refresh it in place and retry the call once, so the
// user never sees the raw error. userpass/approle renew silently from the stored
// auth values; token auth (and stale stored creds) can't, and surface as a
// ReauthRequired so the popup can route to a re-auth screen.

import { methodById } from '../auth/index';
import { VaultHttp, isInvalidToken } from '../vault/http';
import {
  loadConfig,
  getSession,
  setSession,
  setTokenInvalid,
  clearTokenInvalid,
} from './state';

/** Thrown when the token is dead and silent renewal isn't possible. */
export class ReauthRequired extends Error {
  constructor(message = 'session expired') {
    super(message);
    this.name = 'ReauthRequired';
  }
}

/**
 * reauthenticate refreshes the Vault token in place using the configured auth
 * method and the stored auth values, persisting the new token to the session
 * record. Throws ReauthRequired (and marks the session token-invalid) when it
 * can't — e.g. token auth with an expired token, or stored creds Vault rejects.
 */
export async function reauthenticate(): Promise<void> {
  const config = await loadConfig();
  const record = await getSession();
  if (!config || !record) throw new ReauthRequired('not connected to Vault');
  const method = methodById(config.authMethodId);
  if (!method) throw new ReauthRequired(`unknown auth method ${config.authMethodId}`);

  const http = new VaultHttp(config.address, config.namespace);
  try {
    const result = await method.renew(http, record.token, record.authValues);
    if (!result.token) throw new Error('renewal returned an empty token');
    await setSession({
      ...record,
      token: result.token,
      entityID: result.entityID || record.entityID,
    });
    await clearTokenInvalid();
  } catch {
    await setTokenInvalid();
    throw new ReauthRequired();
  }
}

/**
 * withReauth runs an operation; if it fails with an invalid-token error, it
 * renews the token and retries the operation once. Vault rejects an invalid token
 * before processing the request, so the failed attempt applied nothing — a single
 * retry is safe for the worker's read/single-write handlers. A failed renewal
 * propagates as ReauthRequired.
 */
export async function withReauth<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    if (!isInvalidToken(err)) throw err;
    await reauthenticate(); // throws ReauthRequired if it can't refresh
    return op();
  }
}
