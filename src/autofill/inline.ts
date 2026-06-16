// In-page autofill menu: a dropdown that appears under a focused login field
// listing matching logins (title + username) and filling the field when one is
// picked. When the vault is locked or nothing matches, it offers a single
// "Open Cowbird" action that opens the toolbar popup.
//
// Kept free of extension APIs: the content script supplies the privileged
// actions (fetch matches / fill / open popup). Item titles and usernames are
// rendered with textContent (never innerHTML) inside an isolated shadow root,
// so page CSS can't style it and page-derived strings can't inject markup.

import { isAutofillTarget, isOtpField, fillOtpCode } from './dom';
import type { MatchesResponse, MatchSummary } from '../messaging/content';

export interface InlineMenuActions {
  fetchMatches: () => Promise<MatchesResponse>;
  /** Fill the given login into the page. Resolves to whether it filled. */
  fillItem: (id: string) => Promise<boolean>;
  /** Fetch the current one-time code for a login, or null on failure. */
  fetchCode: (id: string) => Promise<string | null>;
  /** Open the toolbar popup. Resolves to whether it actually opened. */
  openPopup: () => Promise<boolean>;
}

type Mode = 'login' | 'otp';

export interface InlineMenu {
  destroy(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// Build the key glyph via DOM APIs rather than innerHTML (which AMO flags as
// unsafe, and which would inherit no benefit here anyway).
function keyIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24',
    width: '15',
    height: '15',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  })) {
    svg.setAttribute(k, v);
  }
  const make = (tag: string, attrs: Record<string, string>) => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };
  svg.append(
    make('circle', { cx: '7.5', cy: '15.5', r: '5.5' }),
    make('path', { d: 'M11.4 11.6 21 2' }),
    make('path', { d: 'm15.5 7.5 3 3' }),
  );
  return svg;
}

export function attachInlineMenu(actions: InlineMenuActions): InlineMenu {
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;z-index:2147483647;display:none;margin:0;padding:0;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    #menu {
      box-sizing: border-box;
      min-width: 240px;
      max-height: 280px;
      overflow-y: auto;
      background: #fff;
      color: #1c1c1e;
      border: 1px solid #d9d9de;
      border-radius: 10px;
      box-shadow: 0 6px 24px rgba(0,0,0,.18);
      padding: 4px;
      font: 13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    }
    .row {
      all: unset;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 8px 10px;
      border-radius: 7px;
      cursor: pointer;
    }
    .row:hover, .row:focus { background: #eef1fb; }
    .row .ic { color: #3b5bdb; flex: 0 0 auto; display: flex; }
    .row .text { min-width: 0; }
    .row .t { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row .u { color: #6b6b70; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .note { padding: 8px 10px; color: #6b6b70; font-size: 12px; }
    @media (prefers-color-scheme: dark) {
      #menu { background: #262629; color: #e6e6ea; border-color: #3a3a3f; }
      .row:hover, .row:focus { background: #2f3340; }
      .row .ic { color: #6b8afd; }
      .row .u { color: #9a9aa2; }
      .note { color: #9a9aa2; }
    }
  `;
  const menu = document.createElement('div');
  menu.id = 'menu';
  menu.setAttribute('role', 'listbox');
  shadow.append(style, menu);
  document.body.appendChild(host);

  let current: HTMLInputElement | null = null;
  let token = 0; // guards against stale async fetch results
  // While our menu is up we set autocomplete="off" on the field so the browser's
  // own credential/autofill dropdown doesn't open on top of ours (Firefox honors
  // this per-field). The original value is restored when we hide.
  let suppressed: { el: HTMLInputElement; prev: string | null } | null = null;

  const restoreNative = () => {
    if (!suppressed) return;
    const { el, prev } = suppressed;
    if (prev === null) el.removeAttribute('autocomplete');
    else el.setAttribute('autocomplete', prev);
    suppressed = null;
  };

  const suppressNative = (el: HTMLInputElement) => {
    if (suppressed?.el === el) return;
    restoreNative();
    suppressed = { el, prev: el.getAttribute('autocomplete') };
    el.setAttribute('autocomplete', 'off');
  };

  const place = () => {
    if (!current) return;
    const r = current.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      hide();
      return;
    }
    host.style.top = `${window.scrollY + r.bottom + 4}px`;
    host.style.left = `${window.scrollX + r.left}px`;
    menu.style.minWidth = `${Math.max(r.width, 240)}px`;
  };

  const hide = () => {
    restoreNative();
    current = null;
    token++; // invalidate any in-flight fetch
    host.style.display = 'none';
    menu.replaceChildren();
  };

  // Build a single row. mousedown is prevented so clicking doesn't blur the
  // field (which would dismiss the menu before the click lands).
  const makeRow = (title: string, sub: string | null, onPick: () => void): HTMLElement => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'row';
    row.setAttribute('role', 'option');
    const ic = document.createElement('span');
    ic.className = 'ic';
    ic.appendChild(keyIcon());
    const text = document.createElement('span');
    text.className = 'text';
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = title;
    text.appendChild(t);
    if (sub) {
      const u = document.createElement('div');
      u.className = 'u';
      u.textContent = sub;
      text.appendChild(u);
    }
    row.append(ic, text);
    row.addEventListener('mousedown', (e) => e.preventDefault());
    row.addEventListener('click', (e) => {
      e.preventDefault();
      onPick();
    });
    return row;
  };

  const renderOpenCowbird = (label: string) => {
    menu.replaceChildren(
      makeRow(label, null, () => {
        void actions.openPopup().then((opened) => {
          if (opened) hide();
          else renderOpenCowbird('Click the Cowbird toolbar icon ↗');
        });
      }),
    );
  };

  // A non-interactive status line, kept open so the user can read the reason a
  // pick didn't complete (no silent dismiss).
  const renderNote = (text: string) => {
    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = text;
    menu.replaceChildren(note);
    place();
  };

  const renderMatches = (matches: MatchSummary[], onPick: (m: MatchSummary) => void) => {
    menu.replaceChildren(
      ...matches.map((m) => makeRow(m.title || '(untitled)', m.username || null, () => onPick(m))),
    );
  };

  const show = async (el: HTMLInputElement, mode: Mode) => {
    current = el;
    const myToken = ++token;
    host.style.display = 'block';
    renderOpenCowbird('Cowbird'); // placeholder while matches load
    place();
    let res: MatchesResponse;
    try {
      res = await actions.fetchMatches();
    } catch {
      res = { locked: true, matches: [] };
    }
    if (myToken !== token || current !== el) return; // focus moved meanwhile
    if (res.locked) {
      renderOpenCowbird('Unlock Cowbird');
    } else {
      // In OTP mode only logins that actually carry a TOTP secret can help.
      const relevant = mode === 'otp' ? res.matches.filter((m) => m.hasTotp) : res.matches;
      if (relevant.length === 0) {
        renderOpenCowbird('Open Cowbird');
      } else if (mode === 'otp') {
        renderMatches(relevant, (m) => {
          void actions.fetchCode(m.id).then((code) => {
            if (!code) {
              renderNote("Couldn't generate a code — check the item's TOTP secret.");
            } else if (fillOtpCode(code, el)) {
              hide();
            } else {
              renderNote('No code field found to fill.');
            }
          });
        });
      } else {
        renderMatches(relevant, (m) => {
          void actions.fillItem(m.id).then(() => hide());
        });
      }
    }
    place();
  };

  const onFocusIn = (e: Event) => {
    const el = (e.composedPath?.()[0] ?? e.target) as HTMLElement | null;
    if (!(el instanceof HTMLInputElement)) return;
    if (el === current) return; // already showing for this field
    if (isAutofillTarget(el)) {
      suppressNative(el);
      void show(el, 'login');
    } else if (isOtpField(el)) {
      suppressNative(el);
      void show(el, 'otp');
    } else if (current) {
      hide();
    }
  };

  const onFocusOut = () => {
    const field = current;
    setTimeout(() => {
      if (field && current === field && document.activeElement !== field) hide();
    }, 150);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && current) hide();
  };

  const onPointerDown = (e: Event) => {
    // A click outside both the field and the menu dismisses it.
    const path = e.composedPath?.() ?? [];
    if (current && !path.includes(host) && !path.includes(current)) hide();
  };

  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);

  return {
    destroy() {
      restoreNative();
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      host.remove();
    },
  };
}
