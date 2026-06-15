// KV is the low-level storage contract the typed VaultStore builds on. Paths are
// logical, relative to the configured KV v2 mount (e.g. "users/<id>/items/<id>").
// Values are the already-unwrapped inner records; the `{"v": "<json>"}` envelope
// the Go app stores around every record is an implementation detail of the HTTP
// backend, not visible here.

/** VaultNotFound signals a 404 from a read or delete (Go's sharing.ErrNotFound). */
export class VaultNotFound extends Error {
  constructor(path: string) {
    super(`not found: ${path}`);
    this.name = 'VaultNotFound';
  }
}

export interface ReadResult {
  value: unknown;
  version: number;
}

export interface KV {
  /** read returns the record and its KV v2 version, or throws VaultNotFound. */
  read(path: string): Promise<ReadResult>;
  /** write stores value and returns the server-assigned version. */
  write(path: string, value: unknown): Promise<number>;
  /** delete removes all versions; throws VaultNotFound on 404. */
  delete(path: string): Promise<void>;
  /** list returns immediate child keys, or [] when the path has none. */
  list(path: string): Promise<string[]>;
}
