// In-page "save / update this login?" banner. Appears after a login submission
// (see capture.ts) offering to store the credential in Cowbird. Like inline.ts it
// lives in an isolated shadow root and renders every string via textContent (no
// innerHTML — AMO-clean, and page-derived values can't inject markup).
//
// The banner never holds the password: it only shows the username/host, and its
// actions (save / recheck) are closures supplied by the content script, which
// owns the captured credential. The password is shown in the page only as a row
// of dots, never the real value.

import type { SaveDecisionResponse } from '../messaging/content';

export interface SavePromptActions {
  /** Persist the captured credential. Resolves to whether it saved. */
  save: (action: 'save' | 'update', id?: string) => Promise<boolean>;
  /** Open the toolbar popup (locked state). Resolves to whether it opened. */
  openPopup: () => Promise<boolean>;
  /** Re-run the save decision (after the user returns from unlocking). */
  recheck: () => Promise<SaveDecisionResponse>;
}

export interface PromptContext {
  username: string;
  host: string;
}

export interface SavePrompt {
  show(decision: SaveDecisionResponse, ctx: PromptContext): void;
  destroy(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function keyIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24',
    width: '18',
    height: '18',
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

export function attachSavePrompt(actions: SavePromptActions): SavePrompt {
  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;top:16px;right:16px;z-index:2147483647;display:none;margin:0;padding:0;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    #card {
      box-sizing: border-box;
      width: 320px;
      background: #fff;
      color: #1c1c1e;
      border: 1px solid #d9d9de;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,.22);
      padding: 14px 16px;
      font: 13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    }
    .head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .head .ic { color: #3b5bdb; flex: 0 0 auto; display: flex; }
    .head .title { font-weight: 600; font-size: 14px; }
    .sub { color: #6b6b70; word-break: break-all; margin-bottom: 12px; }
    .sub .u { color: #1c1c1e; font-weight: 500; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; }
    button {
      all: unset;
      box-sizing: border-box;
      cursor: pointer;
      padding: 7px 14px;
      border-radius: 8px;
      font-weight: 500;
    }
    .primary { background: #3b5bdb; color: #fff; }
    .primary:hover { background: #2f4ac0; }
    .ghost { color: #6b6b70; }
    .ghost:hover { background: #eef1fb; color: #1c1c1e; }
    @media (prefers-color-scheme: dark) {
      #card { background: #262629; color: #e6e6ea; border-color: #3a3a3f; }
      .head .ic { color: #6b8afd; }
      .sub { color: #9a9aa2; }
      .sub .u { color: #e6e6ea; }
      .primary { background: #4f6ef2; }
      .primary:hover { background: #6b8afd; }
      .ghost { color: #9a9aa2; }
      .ghost:hover { background: #2f3340; color: #e6e6ea; }
    }
  `;
  const card = document.createElement('div');
  card.id = 'card';
  shadow.append(style, card);
  document.body.appendChild(host);

  let dismissTimer = 0;
  let onVisible: (() => void) | null = null;

  const clearVisible = () => {
    if (onVisible) {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      onVisible = null;
    }
  };

  const hide = () => {
    clearVisible();
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = 0;
    }
    host.style.display = 'none';
    card.replaceChildren();
  };

  // render builds the card from primitives. `sub` may be a plain string or a
  // (label, value) pair where value is emphasized.
  const render = (
    title: string,
    sub: { text: string } | { label: string; value: string },
    buttons: { label: string; kind: 'primary' | 'ghost'; onClick: () => void }[],
  ) => {
    const head = document.createElement('div');
    head.className = 'head';
    const ic = document.createElement('span');
    ic.className = 'ic';
    ic.appendChild(keyIcon());
    const titleEl = document.createElement('span');
    titleEl.className = 'title';
    titleEl.textContent = title;
    head.append(ic, titleEl);

    const subEl = document.createElement('div');
    subEl.className = 'sub';
    if ('text' in sub) {
      subEl.textContent = sub.text;
    } else {
      const u = document.createElement('span');
      u.className = 'u';
      u.textContent = sub.value;
      subEl.append(document.createTextNode(`${sub.label} `), u);
    }

    const actionsEl = document.createElement('div');
    actionsEl.className = 'actions';
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = b.kind;
      btn.textContent = b.label;
      btn.addEventListener('click', b.onClick);
      actionsEl.appendChild(btn);
    }

    card.replaceChildren(head, subEl, actionsEl);
    host.style.display = 'block';
  };

  const renderStatus = (title: string, text: string) => {
    render(title, { text }, []);
  };

  const finishSaved = () => {
    renderStatus('Saved to Cowbird', '✓ This login is now in your vault.');
    dismissTimer = window.setTimeout(hide, 1800);
  };

  const runSave = (action: 'save' | 'update', id: string | undefined, title: string) => {
    renderStatus(title, 'Saving…');
    void actions.save(action, id).then((ok) => {
      if (ok) finishSaved();
      else renderStatus(title, "Couldn't save — open Cowbird and try again.");
    });
  };

  const show = (decision: SaveDecisionResponse, ctx: PromptContext) => {
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = 0;
    }
    clearVisible();

    if (decision.kind === 'none') {
      hide();
      return;
    }

    if (decision.kind === 'save') {
      render(
        'Save login to Cowbird?',
        ctx.username ? { label: 'Save', value: `${ctx.username} · ${ctx.host}` } : { text: ctx.host },
        [
          { label: 'Not now', kind: 'ghost', onClick: hide },
          { label: 'Save', kind: 'primary', onClick: () => runSave('save', undefined, 'Save login to Cowbird?') },
        ],
      );
      return;
    }

    if (decision.kind === 'update') {
      const id = decision.id;
      render(
        'Update password in Cowbird?',
        { label: 'Update', value: decision.title || ctx.host },
        [
          { label: 'Not now', kind: 'ghost', onClick: hide },
          { label: 'Update', kind: 'primary', onClick: () => runSave('update', id, 'Update password in Cowbird?') },
        ],
      );
      return;
    }

    // locked: offer to unlock, then re-evaluate when the user returns to the tab.
    const recheck = () => {
      clearVisible();
      void actions.recheck().then((next) => {
        if (next.kind === 'locked') {
          // Still locked — keep waiting for the next return.
          armRecheck();
        } else {
          show(next, ctx);
        }
      });
    };
    const armRecheck = () => {
      onVisible = () => {
        if (document.visibilityState === 'visible') recheck();
      };
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('focus', onVisible);
    };
    render(
      'Save login to Cowbird',
      { text: `Unlock Cowbird to save this login for ${ctx.host}.` },
      [
        { label: 'Not now', kind: 'ghost', onClick: hide },
        {
          label: 'Unlock',
          kind: 'primary',
          onClick: () => {
            armRecheck();
            renderStatus('Save login to Cowbird', 'Unlock Cowbird, then return to this tab.');
            void actions.openPopup();
          },
        },
      ],
    );
  };

  return {
    show,
    destroy() {
      hide();
      host.remove();
    },
  };
}
