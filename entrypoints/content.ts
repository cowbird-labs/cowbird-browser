import { defineContentScript } from 'wxt/utils/define-content-script';
import browser from 'webextension-polyfill';
import { hasLoginForm, fillCredentials } from '../src/autofill/dom';
import { attachInlineIcon } from '../src/autofill/inline';
import type {
  ContentMessage,
  DetectResponse,
  FillResponse,
  BackgroundMessage,
  OpenPopupResponse,
} from '../src/messaging/content';

// Injected on every page. It acts on explicit popup requests (detect/fill) and
// shows an in-field icon that, when clicked, asks the worker to open the popup.
// It does not read or transmit page content on its own, and renders no item data.
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

    // The icon only requests that the popup open; the popup itself surfaces the
    // matching logins (CurrentSite) and keeps all secrets in the worker.
    attachInlineIcon(async () => {
      const req: BackgroundMessage = { type: 'cowbird:openPopup' };
      try {
        const res = (await browser.runtime.sendMessage(req)) as OpenPopupResponse | undefined;
        return Boolean(res?.opened);
      } catch {
        return false;
      }
    });
  },
});
