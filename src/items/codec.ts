import { utf8, fromUtf8 } from '../crypto/b64';
import type { Content, ItemType } from './types';

// Mirrors internal/items/codec.go. Content is encoded as a {type, data} envelope
// so Decode can reconstruct the concrete type without an out-of-band hint. Go's
// json.RawMessage embeds the inner object verbatim, which JSON.stringify of a
// nested object reproduces.

interface ContentEnvelope {
  type: ItemType;
  data: unknown;
}

/** encode serializes a Content value to a {type, data} JSON byte string. */
export function encode(content: Content): Uint8Array {
  const env: ContentEnvelope = { type: content.kind, data: content.data };
  return utf8(JSON.stringify(env));
}

/** decode parses a {type, data} envelope back into a tagged Content value. */
export function decode(bytes: Uint8Array): Content {
  const env = JSON.parse(fromUtf8(bytes)) as ContentEnvelope;
  switch (env.type) {
    case 'login':
    case 'card':
    case 'note':
    case 'identity':
    case 'password':
    case 'custom':
      return { kind: env.type, data: env.data } as Content;
    default:
      throw new Error(`unknown item type ${JSON.stringify(env.type)}`);
  }
}
