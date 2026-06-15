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
