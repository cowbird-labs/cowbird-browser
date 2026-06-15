import browser from 'webextension-polyfill';
import { initCrypto } from '../crypto/sodium';
import { dispatch } from './handlers';
import type { RpcRequest, RpcResponse } from '../messaging/protocol';

// The background worker owns all key material and Vault access; the popup never
// touches Vault or crypto directly, only this RPC surface. startBackground wires
// up the message listener and is invoked from the wxt background entrypoint.

export function startBackground(): void {
  const ready = initCrypto();

  browser.runtime.onMessage.addListener((message: unknown): Promise<RpcResponse> => {
    const req = message as RpcRequest;
    return (async (): Promise<RpcResponse> => {
      await ready;
      try {
        const result = await dispatch(req.method, req.params);
        return { ok: true, result };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    })();
  });
}
