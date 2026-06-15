import type { VaultHttp } from '../vault/http';
import type { AuthField, AuthMethod, AuthResult, LoginResponse } from './types';

/** AppRole authenticates with a Vault AppRole role ID and secret ID. */
export const approle: AuthMethod = {
  id: 'approle',
  name: 'AppRole',

  fields(): AuthField[] {
    return [
      { key: 'role_id', label: 'Role ID', secret: false },
      { key: 'secret_id', label: 'Secret ID', secret: true },
    ];
  },

  validate(values: Record<string, string>): string | null {
    if (!values.role_id) return 'role ID is required';
    if (!values.secret_id) return 'secret ID is required';
    return null;
  },

  async authenticate(http: VaultHttp, values: Record<string, string>): Promise<AuthResult> {
    const resp = await http.request<LoginResponse>('POST', 'auth/approle/login', {
      role_id: values.role_id ?? '',
      secret_id: values.secret_id ?? '',
    });
    return {
      token: resp.auth?.client_token ?? '',
      entityID: resp.auth?.entity_id ?? '',
      displayName: resp.auth?.metadata?.role_name ?? '',
    };
  },

  async renew(
    http: VaultHttp,
    tok: string,
    values: Record<string, string>,
  ): Promise<AuthResult> {
    http.token = tok;
    try {
      const resp = await http.request<LoginResponse>('POST', 'auth/token/renew-self', {});
      return {
        token: resp.auth?.client_token ?? tok,
        entityID: resp.auth?.entity_id ?? '',
        displayName: '',
      };
    } catch {
      return this.authenticate(http, values);
    }
  },
};
