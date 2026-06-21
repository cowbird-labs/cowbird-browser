import type { Content } from '../items/types';

// Mirrors internal/transfer: bidirectional adapters ("codecs") between cowbird's
// item model and the import/export file formats of other password managers. Pure
// — they depend only on the item model, so the worker (and any future surface)
// can share them. Marshal/unmarshal are async to accommodate container formats
// like 1Password's .1pux ZIP.

export interface DecodeResult {
  contents: Content[];
  /** Entries skipped because they could not be mapped (non-fatal). */
  skipped: number;
}

export interface Codec {
  id: string; // stable identifier, e.g. "bitwarden"
  name: string; // human label for the UI, e.g. "Bitwarden (JSON)"
  extension: string; // default file extension including the dot, e.g. ".json"
  marshal(contents: Content[]): Promise<Uint8Array>;
  unmarshal(data: Uint8Array): Promise<DecodeResult>;
}
