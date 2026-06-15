import { sodium } from './sodium';

export interface Sealed {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

/**
 * seal encrypts plaintext with XChaCha20-Poly1305 (IETF) using key. aad is
 * authenticated but not encrypted (pass null when none); the same aad must be
 * supplied to open. Returns the randomly generated 24-byte nonce and the
 * ciphertext+tag. Mirrors crypto.Seal in the Go app.
 */
export function seal(key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array | null): Sealed {
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    aad,
    null,
    nonce,
    key,
  );
  return { nonce, ciphertext };
}

/**
 * open decrypts XChaCha20-Poly1305 ciphertext, authenticating aad (which must
 * match what was passed to seal). Throws a generic Error on any failure to
 * avoid leaking whether the cause was a wrong key, wrong aad, or tampering.
 */
export function open(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array | null,
): Uint8Array {
  try {
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, aad, nonce, key);
  } catch {
    throw new Error('decryption failed');
  }
}
