import browser from 'webextension-polyfill';
import { initCrypto } from '../crypto/sodium';
import { dispatch } from './handlers';
import type { RpcRequest, RpcResponse } from '../messaging/protocol';
import type { BackgroundMessage, OpenPopupResponse } from '../messaging/content';

// The background worker owns all key material and Vault access; the popup never
// touches Vault or crypto directly, only this RPC surface. startBackground wires
// up the message listener and is invoked from the wxt background entrypoint.

export function startBackground(): void {
  const ready = initCrypto();

  browser.runtime.onMessage.addListener(
    (message: unknown): Promise<RpcResponse | OpenPopupResponse> => {
      // Control messages from the content script's in-field icon carry a `type`;
      // RPC requests from the popup carry a `method`.
      if ((message as BackgroundMessage)?.type === 'cowbird:openPopup') {
        return openActionPopup();
      }
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
    },
  );
}

// openActionPopup opens the toolbar popup programmatically. Support is uneven:
// Chrome exposes action.openPopup() (recent versions) and Firefox MV2 exposes
// browserAction.openPopup() but only from a user gesture, which may not survive
// the message hop. On failure we report opened:false so the page can fall back
// to a "click the toolbar icon" hint.
async function openActionPopup(): Promise<OpenPopupResponse> {
  // MV3 Chrome exposes `action`, Firefox MV2 exposes `browserAction`; either may
  // carry openPopup. Cast once through unknown to read whichever is present.
  const b = browser as unknown as {
    action?: { openPopup?: () => Promise<void> };
    browserAction?: { openPopup?: () => Promise<void> };
  };
  const action = b.action ?? b.browserAction;
  try {
    if (action?.openPopup) {
      await action.openPopup();
      return { opened: true };
    }
  } catch {
    // Not permitted (no gesture) or unsupported — fall through.
  }
  return { opened: false };
}
