/** isLocalHost reports whether host is a loopback address exempt from the
 * HTTPS requirement (so plain-http dev against a local Vault still works). */
function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

/**
 * normalizeAddress canonicalizes a Vault address before it is stored/used:
 * defaults a missing scheme to https (a scheme-less address would otherwise be
 * misparsed by fetch — the leading host gets read as the URL scheme) and strips
 * trailing slashes. This is what makes "https will be assumed" actually true.
 *
 * It also rejects cleartext http:// to non-loopback hosts: the Vault session
 * token rides in the X-Vault-Token header, so plain http would expose it (and
 * all KV traffic) on the wire. Loopback hosts are allowed for local dev.
 */
export function normalizeAddress(address: string): string {
  const trimmed = address.trim();
  if (!trimmed) return trimmed;
  const withScheme = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`invalid Vault address: ${JSON.stringify(address)}`);
  }
  if (url.protocol === 'http:' && !isLocalHost(url.hostname)) {
    throw new Error(
      'Vault address must use https:// (plain http would expose the Vault token); ' +
        'http:// is only allowed for localhost',
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Vault address must use https://, got ${url.protocol}//`);
  }
  return withScheme.replace(/\/+$/, '');
}

/** VaultConfig is the connection configuration the extension persists. */
export interface VaultConfig {
  /** Base Vault address, e.g. "https://vault.example.com:8200". */
  address: string;
  /** KV v2 mount path, e.g. "cowbird". */
  mount: string;
  /** Optional Vault Enterprise namespace. */
  namespace?: string;
  /** Stable id of the auth method (see auth/index.ts). */
  authMethodId: string;
}
