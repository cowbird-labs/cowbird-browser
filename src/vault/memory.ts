import { VaultNotFound, type KV, type ReadResult } from './kv';

// MemoryKv is an in-memory KV backend for tests and offline development. It
// reproduces KV v2 semantics that the code relies on: monotonically increasing
// per-path versions and immediate-child listing (subdirectories reported with a
// trailing slash). Values are round-tripped through JSON so non-serializable
// records fail here exactly as they would over the wire.

export class MemoryKv implements KV {
  private store = new Map<string, { json: string; version: number }>();

  async read(path: string): Promise<ReadResult> {
    const entry = this.store.get(path);
    if (!entry) throw new VaultNotFound(path);
    return { value: JSON.parse(entry.json), version: entry.version };
  }

  async write(path: string, value: unknown): Promise<number> {
    const version = (this.store.get(path)?.version ?? 0) + 1;
    this.store.set(path, { json: JSON.stringify(value), version });
    return version;
  }

  async delete(path: string): Promise<void> {
    if (!this.store.delete(path)) throw new VaultNotFound(path);
  }

  async list(path: string): Promise<string[]> {
    const prefix = path.endsWith('/') ? path : `${path}/`;
    const keys = new Set<string>();
    for (const key of this.store.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf('/');
      keys.add(slash === -1 ? rest : `${rest.slice(0, slash)}/`);
    }
    return [...keys];
  }
}
