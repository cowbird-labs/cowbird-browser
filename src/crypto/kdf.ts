import { argon2id } from 'hash-wasm';
import { sodium } from './sodium';
import { utf8 } from './b64';

// Mirrors internal/crypto/kdf.go. Password-derived keys are Argon2id followed by
// HKDF-SHA256 for domain separation. The version set is append-only: every locked
// record stores the version it was derived under, so raising the default never
// invalidates existing records. Version 0 (absent) means a pre-versioning record
// and is read as kdfV1.

export const SALT_LEN = 32;

export const KDF_V1 = 1;
export const KDF_V2 = 2;
/** The version new records are locked under. */
export const CURRENT_KDF_VERSION = KDF_V2;

interface KdfParams {
  time: number; // iterations
  memoryKiB: number;
  threads: number; // parallelism
  keyLen: number;
}

const KDF_VERSIONS: Record<number, KdfParams> = {
  [KDF_V1]: { time: 3, memoryKiB: 64 * 1024, threads: 4, keyLen: 32 },
  [KDF_V2]: { time: 25, memoryKiB: 64 * 1024, threads: 4, keyLen: 32 },
};

function paramsForVersion(version: number): KdfParams {
  const v = version === 0 ? KDF_V1 : version;
  const p = KDF_VERSIONS[v];
  if (!p) throw new Error(`unknown KDF version ${version}`);
  return p;
}

/** generateSalt returns a 32-byte cryptographically random salt. */
export function generateSalt(): Uint8Array {
  return sodium.randombytes_buf(SALT_LEN);
}

/**
 * deriveUnlockKey derives the 32-byte unlock key from the password and salt.
 * Lock paths pass CURRENT_KDF_VERSION; unlock re-derives under the version the
 * record was written with.
 */
export async function deriveUnlockKey(
  password: Uint8Array,
  salt: Uint8Array,
  version: number = CURRENT_KDF_VERSION,
): Promise<Uint8Array> {
  const p = paramsForVersion(version);
  const master = (await argon2id({
    password,
    salt,
    parallelism: p.threads,
    iterations: p.time,
    memorySize: p.memoryKiB,
    hashLength: p.keyLen,
    outputType: 'binary',
  })) as Uint8Array;
  return hkdfSha256(master, salt, utf8('cowbird-unlock-v1'), 32);
}

/**
 * hkdfSha256 is RFC 5869 HKDF (extract + expand) over SHA-256, matching Go's
 * golang.org/x/crypto/hkdf. Implemented via Web Crypto, which is available in
 * Node, extension service workers, and page contexts.
 */
export async function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

/** needsKDFUpgrade reports whether a record was derived under an older version. */
export function needsKDFUpgrade(version: number): boolean {
  const v = version === 0 ? KDF_V1 : version;
  return v < CURRENT_KDF_VERSION;
}
