import type { VaultHttp } from '../vault/http';
import type { AuthField, AuthMethod, AuthResult, LoginResponse, TokenLookupResponse } from './types';

/** Token authenticates with a static Vault token; the token is itself the credential. */
export const token: AuthMethod = {
  id: 'token',
  name: 'Token',

  fields(): AuthField[] {
    return [{ key: 'token', label: 'Token', secret: true }];
  },

  validate(values: Record<string, string>): string | null {
    if (!values.token) return 'token is required';
    return null;
  },

  async authenticate(http: VaultHttp, values: Record<string, string>): Promise<AuthResult> {
    // Validate the token and retrieve the entity ID via a self-lookup.
    http.token = values.token ?? '';
    const resp = await http.request<TokenLookupResponse>('GET', 'auth/token/lookup-self');
    return {
      token: values.token ?? '',
      entityID: resp.data?.entity_id ?? '',
      displayName: resp.data?.display_name ?? '',
    };
  },

  async renew(http: VaultHttp, tok: string): Promise<AuthResult> {
    http.token = tok;
    // Token auth has no re-auth path; a failed renewal surfaces as an error.
    const resp = await http.request<LoginResponse>('POST', 'auth/token/renew-self', {});
    return {
      token: resp.auth?.client_token ?? tok,
      entityID: resp.auth?.entity_id ?? '',
      displayName: '',
    };
  },
};
