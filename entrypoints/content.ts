import { defineContentScript } from 'wxt/utils/define-content-script';
import browser from 'webextension-polyfill';
import { hasLoginForm, fillCredentials } from '../src/autofill/dom';
import { attachInlineMenu } from '../src/autofill/inline';
import { watchSubmissions } from '../src/autofill/capture';
import type { Credential } from '../src/autofill/capture';
import { attachSavePrompt } from '../src/autofill/savePrompt';
import type {
  ContentMessage,
  DetectResponse,
  FillResponse,
  BackgroundMessage,
  OpenPopupResponse,
  MatchesResponse,
  FillItemResponse,
  FillCodeResponse,
  SaveDecisionResponse,
  SaveCredentialResponse,
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

    // Save / update offer: capture submitted logins and let the worker decide
    // whether to offer storing them. `pending` holds the captured credential so
    // the banner's actions never need to carry the password themselves.
    let pending: Credential | null = null;
    const decide = (cred: Credential) =>
      send<SaveDecisionResponse>({
        type: 'cowbird:saveDecision',
        username: cred.username,
        password: cred.password,
      });

    const savePrompt = attachSavePrompt({
      async save(action, id) {
        if (!pending) return false;
        try {
          const res = await send<SaveCredentialResponse>({
            type: 'cowbird:saveCredential',
            action,
            id,
            username: pending.username,
            password: pending.password,
          });
          return Boolean(res && 'ok' in res);
        } catch {
          return false;
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
      async recheck() {
        if (!pending) return { kind: 'none' };
        try {
          return (await decide(pending)) ?? { kind: 'locked' };
        } catch {
          return { kind: 'locked' };
        }
      },
    });

    watchSubmissions(async (cred) => {
      pending = cred;
      let decision: SaveDecisionResponse;
      try {
        decision = (await decide(cred)) ?? { kind: 'locked' };
      } catch {
        return;
      }
      if (decision.kind === 'none') return;
      savePrompt.show(decision, { username: cred.username, host: location.hostname });
    });
  },
});
