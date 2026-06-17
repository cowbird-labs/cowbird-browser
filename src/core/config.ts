/**
 * normalizeAddress canonicalizes a Vault address before it is stored/used:
 * defaults a missing scheme to https (a scheme-less address would otherwise be
 * misparsed by fetch — the leading host gets read as the URL scheme) and strips
 * trailing slashes. This is what makes "https will be assumed" actually true.
 */
export function normalizeAddress(address: string): string {
  const trimmed = address.trim();
  if (!trimmed) return trimmed;
  const withScheme = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
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
