import type { VaultHttp } from '../vault/http';
import type { AuthField, AuthMethod, AuthResult, LoginResponse } from './types';

/** Userpass authenticates with a Vault userpass username and password. */
export const userpass: AuthMethod = {
  id: 'userpass',
  name: 'Username & Password',

  fields(): AuthField[] {
    return [
      { key: 'username', label: 'Username', secret: false },
      { key: 'password', label: 'Password', secret: true },
    ];
  },

  validate(values: Record<string, string>): string | null {
    if (!values.username) return 'username is required';
    if (!values.password) return 'password is required';
    return null;
  },

  async authenticate(http: VaultHttp, values: Record<string, string>): Promise<AuthResult> {
    const resp = await http.request<LoginResponse>(
      'POST',
      `auth/userpass/login/${encodeURIComponent(values.username ?? '')}`,
      { password: values.password ?? '' },
    );
    return {
      token: resp.auth?.client_token ?? '',
      entityID: resp.auth?.entity_id ?? '',
      displayName: resp.auth?.metadata?.username ?? '',
    };
  },

  async renew(
    http: VaultHttp,
    token: string,
    values: Record<string, string>,
  ): Promise<AuthResult> {
    http.token = token;
    try {
      const resp = await http.request<LoginResponse>('POST', 'auth/token/renew-self', {});
      return {
        token: resp.auth?.client_token ?? token,
        entityID: resp.auth?.entity_id ?? '',
        displayName: '',
      };
    } catch {
      return this.authenticate(http, values);
    }
  },
};
