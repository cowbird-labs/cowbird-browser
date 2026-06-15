// DOM detection and filling for login forms. Runs inside the content script.
// Kept free of extension APIs so the logic is self-contained.

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
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]')).filter(
    isVisible,
  );
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
  const scope: ParentNode = pw.form ?? document;
  const inputs = Array.from(scope.querySelectorAll<HTMLInputElement>('input')).filter(
    (i) => isTextLike(i) && isVisible(i),
  );
  // Prefer fields that appear before the password field in document order.
  const preceding = inputs.filter(
    (i) => (pw.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_PRECEDING) !== 0,
  );
  const pool = preceding.length > 0 ? preceding : inputs;
  if (pool.length === 0) return null;
  return pool
    .map((input) => ({ input, score: usernameScore(input) }))
    .sort((a, b) => b.score - a.score)[0]!.input;
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
    const lone = Array.from(document.querySelectorAll<HTMLInputElement>('input')).find(
      (i) => isTextLike(i) && isVisible(i),
    );
    if (lone) {
      setNativeValue(lone, username);
      filled = true;
    }
  }
  return filled;
}
