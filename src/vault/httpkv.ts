import { VaultHttp, isStatus } from './http';
import { VaultNotFound, type KV, type ReadResult } from './kv';

// HttpKv maps the logical KV contract onto Vault's KV v2 REST API and applies
// the `{"v": "<json>"}` record envelope the Go app uses uniformly. Read/delete
// surface 404 as VaultNotFound; list surfaces 404 as an empty slice.

interface KvReadResponse {
  data?: {
    data?: { v?: string } | null;
    metadata?: { version?: number };
  };
}

interface KvWriteResponse {
  data?: { version?: number };
}

interface KvListResponse {
  data?: { keys?: string[] };
}

export class HttpKv implements KV {
  constructor(
    private http: VaultHttp,
    private mount: string,
  ) {}

  private dataPath(path: string): string {
    return `${this.mount}/data/${path}`;
  }

  private metadataPath(path: string): string {
    return `${this.mount}/metadata/${path}`;
  }

  async read(path: string): Promise<ReadResult> {
    let resp: KvReadResponse;
    try {
      resp = await this.http.request<KvReadResponse>('GET', this.dataPath(path));
    } catch (err) {
      if (isStatus(err, 404)) throw new VaultNotFound(path);
      throw err;
    }
    const data = resp.data?.data;
    if (data == null || typeof data.v !== 'string') {
      throw new VaultNotFound(path);
    }
    return {
      value: JSON.parse(data.v),
      version: Number(resp.data?.metadata?.version ?? 0),
    };
  }

  async write(path: string, value: unknown): Promise<number> {
    const resp = await this.http.request<KvWriteResponse>('POST', this.dataPath(path), {
      data: { v: JSON.stringify(value) },
    });
    return Number(resp.data?.version ?? 0);
  }

  async delete(path: string): Promise<void> {
    try {
      await this.http.request('DELETE', this.metadataPath(path));
    } catch (err) {
      if (isStatus(err, 404)) throw new VaultNotFound(path);
      throw err;
    }
  }

  async list(path: string): Promise<string[]> {
    try {
      const resp = await this.http.request<KvListResponse>(
        'GET',
        `${this.metadataPath(path)}?list=true`,
      );
      return resp.data?.keys ?? [];
    } catch (err) {
      if (isStatus(err, 404)) return [];
      throw err;
    }
  }
}
