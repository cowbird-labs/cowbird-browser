// DOM detection and filling for login forms. Runs inside the content script.
// Kept free of extension APIs so the logic is self-contained.

// deepQueryAll collects every element matching `selector`, descending through
// open shadow roots. Sites built on Web Components (Reddit's faceplate-* inputs,
// many design systems) hide their real <input>s inside shadow DOM, where a plain
// document.querySelectorAll can't see them. Closed shadow roots and cross-origin
// iframes remain out of reach (no API to pierce them).
function deepQueryAll<T extends Element>(selector: string, root: ParentNode = document): T[] {
  const out: T[] = [];
  const visit = (node: ParentNode) => {
    for (const el of node.querySelectorAll<T>(selector)) out.push(el);
    for (const el of node.querySelectorAll('*')) {
      const sr = (el as Element).shadowRoot;
      if (sr) visit(sr);
    }
  };
  visit(root);
  return out;
}

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

function isTextLike(input: HTMLInputElement): boolean {
  const type = (input.getAttribute('type') ?? 'text').toLowerCase();
  return type === 'text' || type === 'email' || type === 'tel' || type === '';
}

function visiblePasswordFields(): HTMLInputElement[] {
  return deepQueryAll<HTMLInputElement>('input[type="password"]').filter(isVisible);
}

/** hasLoginForm reports whether the page has a visible password field. */
export function hasLoginForm(): boolean {
  return visiblePasswordFields().length > 0;
}

// usernameScore ranks how likely an input is the username/email field.
function usernameScore(input: HTMLInputElement): number {
  let score = 0;
  const autocomplete = (input.autocomplete || '').toLowerCase();
  if (autocomplete.includes('username') || autocomplete.includes('email')) score += 4;
  if ((input.getAttribute('type') ?? '').toLowerCase() === 'email') score += 2;
  const hint = `${input.name} ${input.id} ${input.getAttribute('aria-label') ?? ''} ${
    input.placeholder ?? ''
  }`.toLowerCase();
  if (/user|email|login|account|phone/.test(hint)) score += 2;
  return score;
}

function findUsernameField(pw: HTMLInputElement): HTMLInputElement | null {
  // Scope to the password's own form when it has one; otherwise search the whole
  // document (piercing shadow roots), since shadow-DOM inputs often aren't
  // form-associated across the boundary.
  const scope: ParentNode = pw.form ?? document;
  const inputs = deepQueryAll<HTMLInputElement>('input', scope).filter(
    (i) => isTextLike(i) && isVisible(i),
  );
  // Prefer fields that appear before the password field in document order. Only
  // trust compareDocumentPosition within the same tree — across shadow roots it
  // reports DISCONNECTED and the ordering bits are implementation-specific.
  const preceding = inputs.filter(
    (i) =>
      i.getRootNode() === pw.getRootNode() &&
      (pw.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_PRECEDING) !== 0,
  );
  const pool = preceding.length > 0 ? preceding : inputs;
  if (pool.length === 0) return null;
  return pool
    .map((input) => ({ input, score: usernameScore(input) }))
    .sort((a, b) => b.score - a.score)[0]!.input;
}

/**
 * loginTargets returns the input fields the in-field autofill icon should attach
 * to: the best username candidate plus any visible password fields, or a lone
 * username field on password-less pages. Empty when the page has no login form.
 */
export function loginTargets(): HTMLInputElement[] {
  const passwords = visiblePasswordFields();
  if (passwords.length > 0) {
    const targets = [...passwords];
    const user = findUsernameField(passwords[0]!);
    if (user) targets.unshift(user);
    return targets;
  }
  const lone = deepQueryAll<HTMLInputElement>('input').find((i) => isTextLike(i) && isVisible(i));
  return lone ? [lone] : [];
}

/**
 * isAutofillTarget reports whether the in-field icon should appear on a focused
 * input. Stricter than loginTargets' fill heuristic so the icon doesn't pop over
 * unrelated text inputs (e.g. site search boxes): a text field only qualifies
 * when it's the username for a real password field, or it explicitly advertises
 * itself as a username/email.
 */
export function isAutofillTarget(el: HTMLInputElement): boolean {
  if (!isVisible(el)) return false;
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  if (type === 'password') return true;
  if (!isTextLike(el)) return false;
  if (visiblePasswordFields().length > 0) return loginTargets().includes(el);
  const ac = (el.autocomplete || '').toLowerCase();
  return type === 'email' || ac.includes('username') || ac.includes('email');
}

// setNativeValue sets an input's value through the native setter so frameworks
// (React/Vue) that track value via property descriptors observe the change, then
// dispatches the input/change events a real edit would produce.
function setNativeValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * fillCredentials fills the best-matching username and password fields. Returns
 * whether anything was filled. Handles password-only and username-only pages.
 */
export function fillCredentials(username: string, password: string): boolean {
  const passwordFields = visiblePasswordFields();
  let filled = false;

  if (passwordFields.length > 0) {
    const pw = passwordFields[0]!;
    if (password) {
      setNativeValue(pw, password);
      filled = true;
    }
    if (username) {
      const userField = findUsernameField(pw);
      if (userField) {
        setNativeValue(userField, username);
        filled = true;
      }
    }
    return filled;
  }

  if (username) {
    const lone = deepQueryAll<HTMLInputElement>('input').find(
      (i) => isTextLike(i) && isVisible(i),
    );
    if (lone) {
      setNativeValue(lone, username);
      filled = true;
    }
  }
  return filled;
}
