import browser from 'webextension-polyfill';
import { clearClipboardViaDom } from '../../src/background/clipboardDom';

// Chrome offscreen document. The MV3 service worker has no DOM and so cannot
// write the clipboard; the worker creates this hidden page (reason: CLIPBOARD),
// sends it a clear request, then closes it. Messages are tagged `target:
// 'offscreen'` so the worker's own onMessage listener ignores them (and this
// listener ignores everything else).

browser.runtime.onMessage.addListener((message: unknown) => {
  const m = message as { target?: string; type?: string } | null;
  if (m?.target !== 'offscreen') return;
  if (m.type === 'cowbird:clearClipboard') {
    clearClipboardViaDom();
    return Promise.resolve({ ok: true });
  }
  return;
});
