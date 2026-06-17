import browser from 'webextension-polyfill';
import type { Method, Params, Result, RpcResponse } from './protocol';

// A worker response can flag that the Vault session expired and silent renewal
// failed (reauth: true). The App registers a handler here so any failed call —
// not just getState — re-routes the UI to the re-auth screen.
let reauthHandler: (() => void) | null = null;
export function setReauthHandler(handler: (() => void) | null): void {
  reauthHandler = handler;
}

/**
 * rpc sends a typed request to the background worker and resolves with its
 * result, or rejects with the worker's error message. Used by the popup UI.
 */
export async function rpc<M extends Method>(method: M, params?: Params<M>): Promise<Result<M>> {
  const response = (await browser.runtime.sendMessage({ method, params })) as RpcResponse | undefined;
  if (!response) throw new Error('no response from background worker');
  if (!response.ok) {
    if (response.reauth) reauthHandler?.();
    throw new Error(response.error);
  }
  return response.result as Result<M>;
}
