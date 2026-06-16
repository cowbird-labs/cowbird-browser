// In-field autofill affordance: a small Cowbird icon shown inside a focused
// login field. Clicking it invokes `onActivate` (wired by the content script to
// ask the background worker to open the toolbar popup). Deliberately minimal —
// no item titles, usernames, or secrets are ever rendered into the page; the
// icon is only an entry point to the trusted extension popup.
//
// Kept free of extension APIs so the autofill logic stays self-contained; the
// content script supplies the privileged `onActivate` action.

import { isAutofillTarget } from './dom';

// feather "key" glyph, inheriting currentColor.
const ICON_SVG =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<circle cx="7.5" cy="15.5" r="5.5"/><path d="M11.4 11.6 21 2"/><path d="m15.5 7.5 3 3"/></svg>';

const ICON_SIZE = 18;

export interface InlineAutofill {
  destroy(): void;
}

/**
 * attachInlineIcon installs the in-field icon. `onActivate` is called on click
 * and should resolve to whether the popup actually opened; if false, the icon
 * shows a brief hint to use the toolbar button instead.
 */
export function attachInlineIcon(onActivate: () => Promise<boolean>): InlineAutofill {
  const host = document.createElement('div');
  host.style.cssText = `position:absolute;z-index:2147483647;display:none;margin:0;padding:0;`;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      #btn {
        all: unset;
        box-sizing: border-box;
        width: ${ICON_SIZE}px; height: ${ICON_SIZE}px;
        display: inline-flex; align-items: center; justify-content: center;
        border-radius: 5px; cursor: pointer;
        background: #fff; color: #3b5bdb;
        border: 1px solid #d9d9de;
        box-shadow: 0 1px 2px rgba(0,0,0,.15);
      }
      #btn:hover { background: #eef1fb; }
      #hint {
        position: absolute; top: ${ICON_SIZE + 4}px; right: 0;
        white-space: nowrap;
        background: #1c1c1e; color: #fff;
        font: 12px system-ui, sans-serif;
        padding: 4px 8px; border-radius: 5px;
        box-shadow: 0 2px 8px rgba(0,0,0,.25);
        display: none;
      }
      @media (prefers-color-scheme: dark) {
        #btn { background: #262629; color: #6b8afd; border-color: #3a3a3f; }
        #btn:hover { background: #2f3340; }
      }
    </style>
    <button id="btn" type="button" part="button" aria-label="Fill with Cowbird" title="Fill with Cowbird">${ICON_SVG}</button>
    <div id="hint"></div>`;
  document.body.appendChild(host);

  const btn = shadow.getElementById('btn') as HTMLButtonElement;
  const hint = shadow.getElementById('hint') as HTMLDivElement;
  let current: HTMLElement | null = null;

  const place = () => {
    if (!current) return;
    const r = current.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      hide();
      return;
    }
    host.style.top = `${window.scrollY + r.top + (r.height - ICON_SIZE) / 2}px`;
    host.style.left = `${window.scrollX + r.right - ICON_SIZE - 6}px`;
  };

  const show = (el: HTMLElement) => {
    current = el;
    hint.style.display = 'none';
    host.style.display = 'block';
    place();
  };

  const hide = () => {
    current = null;
    host.style.display = 'none';
  };

  // Keep focus in the field when the icon is pressed so the page sees no blur.
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    void onActivate().then((opened) => {
      if (!opened) {
        hint.textContent = 'Open the Cowbird toolbar icon ↗';
        hint.style.display = 'block';
      }
    });
  });

  const onFocusIn = (e: Event) => {
    const el = (e.composedPath?.()[0] ?? e.target) as HTMLElement | null;
    // Cheap guard before the (shadow-piercing) target scan: only inputs qualify.
    if (!(el instanceof HTMLInputElement)) return;
    if (isAutofillTarget(el)) show(el);
    else if (current) hide();
  };

  const onFocusOut = () => {
    // Defer so an icon click (we keep focus on the field through mousedown) isn't
    // cut off; hide once focus has truly moved off the field.
    const field = current;
    setTimeout(() => {
      if (field && current === field && document.activeElement !== field) hide();
    }, 150);
  };

  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);

  return {
    destroy() {
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      host.remove();
    },
  };
}
