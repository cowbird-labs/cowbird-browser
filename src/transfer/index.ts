import type { Codec } from './types';
import { cowbirdCodec } from './cowbird';
import { bitwardenCodec } from './bitwarden';
import { onePasswordCodec } from './onepassword';
import { protonCodec } from './proton';
import { lastPassCodec } from './lastpass';

// The ordered codec registry. Cowbird-native is first (the default); the vendor
// formats follow. Mirrors internal/transfer/transfer.go.
const codecs: Codec[] = [
  cowbirdCodec,
  bitwardenCodec,
  onePasswordCodec,
  protonCodec,
  lastPassCodec,
];

/** allCodecs returns the available codecs in display order. */
export function allCodecs(): Codec[] {
  return codecs;
}

/** getCodec returns the codec with the given id, or undefined. */
export function getCodec(id: string): Codec | undefined {
  return codecs.find((c) => c.id === id);
}

/** defaultCodec returns the codec used when none is chosen (cowbird-native). */
export function defaultCodec(): Codec {
  return codecs[0]!;
}

export type { Codec, DecodeResult } from './types';
