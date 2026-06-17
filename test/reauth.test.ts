import { describe, expect, it, vi } from 'vitest';
import { VaultResponseError, isInvalidToken } from '../src/vault/http';
import type { VaultHttp } from '../src/vault/http';
import { userpass } from '../src/auth/userpass';
import { approle } from '../src/auth/approle';

describe('isInvalidToken', () => {
  it('is true for a 403 mentioning an invalid token', () => {
    expect(isInvalidToken(new VaultResponseError(403, ['permission denied', 'invalid token']))).toBe(
      true,
    );
  });

  it('is true for a 401 mentioning an invalid token', () => {
    expect(isInvalidToken(new VaultResponseError(401, ['invalid token']))).toBe(true);
  });

  it('is false for a plain permission denial (real policy 403)', () => {
    expect(isInvalidToken(new VaultResponseError(403, ['permission denied']))).toBe(false);
  });

  it('is false for other status codes and non-Vault errors', () => {
    expect(isInvalidToken(new VaultResponseError(404, ['invalid token']))).toBe(false);
    expect(isInvalidToken(new Error('invalid token'))).toBe(false);
    expect(isInvalidToken(null)).toBe(false);
  });
});

// A stub VaultHttp whose request() fails renew-self (as an expired token would)
// but succeeds the login call, so we can assert renew() falls back to a full
// re-login from the stored credentials.
function stubHttp(): { http: VaultHttp; loginPaths: string[] } {
  const loginPaths: string[] = [];
  const http = {
    token: '',
    request: vi.fn(async (_method: string, path: string) => {
      if (path === 'auth/token/renew-self') {
        throw new VaultResponseError(403, ['permission denied', 'invalid token']);
      }
      loginPaths.push(path);
      return { auth: { client_token: 'fresh-token', entity_id: 'e1' } };
    }),
  } as unknown as VaultHttp;
  return { http, loginPaths };
}

describe('AuthMethod.renew silent re-login fallback', () => {
  it('userpass re-logs in with stored credentials when renew-self fails', async () => {
    const { http, loginPaths } = stubHttp();
    const result = await userpass.renew(http, 'dead-token', {
      username: 'alice',
      password: 'pw',
    });
    expect(result.token).toBe('fresh-token');
    expect(loginPaths).toEqual(['auth/userpass/login/alice']);
  });

  it('approle re-logs in with stored role/secret when renew-self fails', async () => {
    const { http, loginPaths } = stubHttp();
    const result = await approle.renew(http, 'dead-token', {
      role_id: 'r',
      secret_id: 's',
    });
    expect(result.token).toBe('fresh-token');
    expect(loginPaths).toEqual(['auth/approle/login']);
  });
});
