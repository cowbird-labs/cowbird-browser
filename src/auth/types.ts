import type { VaultHttp } from '../vault/http';

/** AuthResult is the output of a successful authentication. */
export interface AuthResult {
  token: string;
  entityID: string;
  displayName: string; // human-readable identity; may be empty (e.g. on renewal)
}

/** AuthField describes one credential input for an auth method. */
export interface AuthField {
  key: string;
  label: string;
  secret: boolean;
}

/** AuthMethod is the interface each Vault auth backend implements. */
export interface AuthMethod {
  /** Stable identifier persisted in config (e.g. "userpass"). */
  readonly id: string;
  /** Human-readable label shown in the UI picker. */
  readonly name: string;
  fields(): AuthField[];
  /** validate checks field values before any network call; returns an error message or null. */
  validate(values: Record<string, string>): string | null;
  /** authenticate performs a full login. */
  authenticate(http: VaultHttp, values: Record<string, string>): Promise<AuthResult>;
  /** renew extends the current token, falling back to a full login where possible. */
  renew(http: VaultHttp, token: string, values: Record<string, string>): Promise<AuthResult>;
}

// Shared Vault auth-response shapes.
export interface LoginResponse {
  auth?: {
    client_token?: string;
    entity_id?: string;
    metadata?: Record<string, string>;
  };
}

export interface TokenLookupResponse {
  data?: {
    entity_id?: string;
    display_name?: string;
  };
}
