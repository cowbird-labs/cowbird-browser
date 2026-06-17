// Host-matching shared by the popup (current-site list) and the background
// worker (scoping in-page autofill requests to the sender frame's host). Kept
// free of extension APIs so both contexts can import it.

/**
 * hostMatches reports whether a stored item URL belongs to the given hostname,
 * allowing subdomain matches in either direction (login.example.com ⇄ example.com).
 */
export function hostMatches(itemUrl: string, host: string): boolean {
  let itemHost: string;
  try {
    itemHost = new URL(itemUrl.includes('://') ? itemUrl : `https://${itemUrl}`).hostname;
  } catch {
    return false;
  }
  if (!itemHost || !host) return false;
  return itemHost === host || host.endsWith(`.${itemHost}`) || itemHost.endsWith(`.${host}`);
}

/** An existing login (decrypted) considered when classifying a fresh submission. */
export interface HostLogin {
  id: string;
  title: string;
  username: string;
  password: string;
}

/** The action a captured submission warrants against the host's existing logins. */
export type SaveClass =
  | { kind: 'none' }
  | { kind: 'save' }
  | { kind: 'update'; id: string; title: string };

// Compare two usernames for "same account" purposes: trimmed, case-insensitive
// (emails and most usernames are case-insensitive in practice).
function sameUser(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * classifySubmission decides whether a submitted username/password is worth
 * offering to save. `hostLogins` are the existing logins whose URLs already match
 * the submission's host.
 *
 * - A login with the same username: same password → `none`; different → `update`.
 *   (An empty submitted username matches an existing empty-username login, which
 *   covers the password-only case.)
 * - Otherwise → `save` (a brand-new login, or an additional account on the site).
 */
export function classifySubmission(
  hostLogins: HostLogin[],
  username: string,
  password: string,
): SaveClass {
  const byUser = hostLogins.find((l) => sameUser(l.username, username));
  if (byUser) {
    return byUser.password === password
      ? { kind: 'none' }
      : { kind: 'update', id: byUser.id, title: byUser.title };
  }
  return { kind: 'save' };
}
