import { sodium } from './sodium';

// Go's encoding/json marshals []byte as standard base64 *with* padding
// (base64.StdEncoding). libsodium's ORIGINAL variant is exactly that, so every
// byte field we exchange with the desktop app round-trips identically.

/** b64encode encodes bytes as standard padded base64 (Go's []byte JSON form). */
export function b64encode(bytes: Uint8Array): string {
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}

/** b64decode parses standard padded base64 back into bytes. */
export function b64decode(s: string): Uint8Array {
  return sodium.from_base64(s, sodium.base64_variants.ORIGINAL);
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function utf8(s: string): Uint8Array {
  return enc.encode(s);
}

export function fromUtf8(bytes: Uint8Array): string {
  return dec.decode(bytes);
}
