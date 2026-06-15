import browser from 'webextension-polyfill';
import type { Method, Params, Result, RpcResponse } from './protocol';

/**
 * rpc sends a typed request to the background worker and resolves with its
 * result, or rejects with the worker's error message. Used by the popup UI.
 */
export async function rpc<M extends Method>(method: M, params?: Params<M>): Promise<Result<M>> {
  const response = (await browser.runtime.sendMessage({ method, params })) as RpcResponse | undefined;
  if (!response) throw new Error('no response from background worker');
  if (!response.ok) throw new Error(response.error);
  return response.result as Result<M>;
}
