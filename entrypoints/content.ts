import { defineContentScript } from 'wxt/utils/define-content-script';
import browser from 'webextension-polyfill';
import { hasLoginForm, fillCredentials } from '../src/autofill/dom';
import type { ContentMessage, DetectResponse, FillResponse } from '../src/messaging/content';

// Injected on every page. It only acts on explicit popup requests (detect/fill)
// — it does not read or transmit page content on its own.
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
  },
});
