import { defineContentScript } from 'wxt/utils/define-content-script';
import browser from 'webextension-polyfill';
import { hasLoginForm, fillCredentials } from '../src/autofill/dom';
import { attachInlineMenu } from '../src/autofill/inline';
import type {
  ContentMessage,
  DetectResponse,
  FillResponse,
  BackgroundMessage,
  OpenPopupResponse,
  MatchesResponse,
  FillItemResponse,
  FillCodeResponse,
} from '../src/messaging/content';

// Injected on every page. It acts on explicit popup requests (detect/fill) and
// shows an on-focus in-page menu of matching logins. All matching/credential
// data comes from the worker scoped to this page's host; the menu renders only
// titles/usernames (no secrets) and fills via the same path as the popup.
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    browser.runtime.onMessage.addListener((message: unknown):
      | Promise<DetectResponse | FillResponse>
      | undefined => {
      const msg = message as ContentMessage;
      if (msg.type === 'cowbird:detect') {
        return Promise.resolve({ hasLogin: hasLoginForm(), host: location.hostname });
      }
      if (msg.type === 'cowbird:fill') {
        return Promise.resolve({ filled: fillCredentials(msg.username, msg.password) });
      }
      return undefined; // not ours — let other listeners handle it
    });

    const send = <T,>(req: BackgroundMessage) =>
      browser.runtime.sendMessage(req) as Promise<T | undefined>;

    attachInlineMenu({
      async fetchMatches() {
        try {
          return (
            (await send<MatchesResponse>({ type: 'cowbird:matches' })) ?? {
              locked: true,
              matches: [],
            }
          );
        } catch {
          return { locked: true, matches: [] };
        }
      },
      async fillItem(id) {
        try {
          const res = await send<FillItemResponse>({ type: 'cowbird:fillItem', id });
          if (!res || 'error' in res) return false;
          return fillCredentials(res.username, res.password);
        } catch {
          return false;
        }
      },
      async fetchCode(id) {
        try {
          const res = await send<FillCodeResponse>({ type: 'cowbird:fillCode', id });
          if (!res || 'error' in res) return null;
          return res.code;
        } catch {
          return null;
        }
      },
      async openPopup() {
        try {
          const res = await send<OpenPopupResponse>({ type: 'cowbird:openPopup' });
          return Boolean(res?.opened);
        } catch {
          return false;
        }
      },
    });
  },
});
