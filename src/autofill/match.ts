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
