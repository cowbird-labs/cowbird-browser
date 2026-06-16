import browser from 'webextension-polyfill';
import type { Runtime } from 'webextension-polyfill';
import { initCrypto } from '../crypto/sodium';
import { dispatch, matchesForHost, credsForItem, codeForItem } from './handlers';
import type { RpcRequest, RpcResponse } from '../messaging/protocol';
import type {
  BackgroundMessage,
  OpenPopupResponse,
  MatchesResponse,
  FillItemResponse,
  FillCodeResponse,
} from '../messaging/content';

// The background worker owns all key material and Vault access; the popup never
// touches Vault or crypto directly, only this RPC surface. startBackground wires
// up the message listener and is invoked from the wxt background entrypoint.

export function startBackground(): void {
  const ready = initCrypto();

  browser.runtime.onMessage.addListener(
    (
      message: unknown,
      sender: Runtime.MessageSender,
    ): Promise<
      RpcResponse | OpenPopupResponse | MatchesResponse | FillItemResponse | FillCodeResponse
    > => {
      // Control messages from the content script carry a `type`; popup RPC
      // requests carry a `method`.
      const ctrl = message as BackgroundMessage;
      switch (ctrl?.type) {
        case 'cowbird:openPopup':
          return openActionPopup();
        case 'cowbird:matches':
          return handleMatches(ready, sender);
        case 'cowbird:fillItem':
          return handleFillItem(ready, sender, ctrl.id);
        case 'cowbird:fillCode':
          return handleFillCode(ready, sender, ctrl.id);
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

// senderHost derives the requesting frame's hostname. Returns null for messages
// that didn't come from a tab's content script (e.g. the popup), so page-scoped
// requests can be refused.
function senderHost(sender: Runtime.MessageSender): string | null {
  if (!sender.tab?.id) return null;
  try {
    return new URL(sender.url ?? sender.tab.url ?? '').hostname || null;
  } catch {
    return null;
  }
}

async function handleMatches(
  ready: Promise<unknown>,
  sender: Runtime.MessageSender,
): Promise<MatchesResponse> {
  await ready;
  const host = senderHost(sender);
  if (!host) return { locked: false, matches: [] };
  try {
    return await matchesForHost(host);
  } catch {
    return { locked: true, matches: [] };
  }
}

async function handleFillItem(
  ready: Promise<unknown>,
  sender: Runtime.MessageSender,
  id: string,
): Promise<FillItemResponse> {
  await ready;
  const host = senderHost(sender);
  if (!host) return { error: 'no host' };
  try {
    return await credsForItem(id, host);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleFillCode(
  ready: Promise<unknown>,
  sender: Runtime.MessageSender,
  id: string,
): Promise<FillCodeResponse> {
  await ready;
  const host = senderHost(sender);
  if (!host) return { error: 'no host' };
  try {
    return await codeForItem(id, host);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
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
