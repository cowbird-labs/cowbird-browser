// Low-level Vault HTTP transport. In the extension this runs inside the MV3
// background service worker (host permissions let it reach Vault without the
// page CORS restrictions), so Vault needs no CORS configuration change.

export class VaultResponseError extends Error {
  constructor(
    public statusCode: number,
    public errors: string[],
  ) {
    super(errors.length ? errors.join('; ') : `vault returned HTTP ${statusCode}`);
    this.name = 'VaultResponseError';
  }
}

interface VaultErrorBody {
  errors?: string[];
}

/** isStatus reports whether err is a VaultResponseError with the given HTTP status. */
export function isStatus(err: unknown, status: number): boolean {
  return err instanceof VaultResponseError && err.statusCode === status;
}

export class VaultHttp {
  /** Session token; set by the auth flow, sent as X-Vault-Token. */
  token = '';

  constructor(
    public address: string,
    public namespace?: string,
  ) {
    this.address = address.replace(/\/+$/, '');
  }

  /** request issues a Vault API call against /v1/<path> and returns parsed JSON. */
  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.token) headers['X-Vault-Token'] = this.token;
    if (this.namespace) headers['X-Vault-Namespace'] = this.namespace;
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const resp = await fetch(`${this.address}/v1/${path}`, init);
    const text = await resp.text();
    let json: unknown;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined; // non-JSON body (e.g. a bare 404)
      }
    }
    if (!resp.ok) {
      const errs = (json as VaultErrorBody | undefined)?.errors ?? [];
      throw new VaultResponseError(resp.status, Array.isArray(errs) ? errs : []);
    }
    return json as T;
  }
}
