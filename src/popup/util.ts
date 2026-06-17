/** errorMessage extracts a human-readable string from an unknown thrown value. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * addressMissingPort reports whether a Vault address parses as a URL but names no
 * explicit port. Vault commonly listens on :8200, and an omitted port silently
 * defaults to 80/443, so this drives a gentle nudge. Returns false for empty or
 * unparseable input (a different problem) and for addresses that do specify a
 * port — including an explicit :443, which is unusual but intentional.
 *
 * The port is detected in the literal text rather than via URL.port, because the
 * URL API normalizes a default port (https→443, http→80) away, which would make
 * an explicit ":443" indistinguishable from an omitted port.
 */
export function addressMissingPort(address: string): boolean {
  const trimmed = address.trim();
  if (!trimmed) return false;
  const withScheme = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
  try {
    new URL(withScheme); // reject unparseable input (a different problem)
  } catch {
    return false;
  }
  // Authority = everything between "://" and the first path/query/fragment.
  const authority = withScheme.slice(withScheme.indexOf('://') + 3).split(/[/?#]/)[0] ?? '';
  if (!authority) return false;
  if (/]:\d+$/.test(authority)) return false; // [IPv6]:port
  if (authority.startsWith('[')) return true; // bracketed IPv6, no port
  const hostport = authority.includes('@')
    ? authority.slice(authority.lastIndexOf('@') + 1)
    : authority;
  return !/:\d+$/.test(hostport); // no trailing :port → missing
}

/**
 * A concern with the address's scheme: `insecure` when it's plain http (Vault
 * credentials would travel unencrypted), `no-scheme` when none is given (https is
 * assumed). null for empty input or a normal https URL.
 */
export type AddressSchemeIssue = 'insecure' | 'no-scheme' | null;

/** addressSchemeIssue classifies the scheme of a Vault address; see the type. */
export function addressSchemeIssue(address: string): AddressSchemeIssue {
  const trimmed = address.trim();
  if (!trimmed) return null;
  if (!trimmed.includes('://')) return 'no-scheme';
  if (/^http:\/\//i.test(trimmed)) return 'insecure';
  return null;
}

/** copyText writes text to the clipboard, swallowing failures. */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard may be unavailable; nothing else to do.
  }
}
