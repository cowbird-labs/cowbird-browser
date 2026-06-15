import { sodium } from './sodium';
import { seal, open } from './aead';
import { hkdfSha256 } from './kdf';
import { utf8 } from './b64';

// Mirrors internal/crypto/wrap.go. An item key is wrapped to a recipient's
// X25519 public key via an ephemeral ECDH exchange + HKDF + XChaCha20-Poly1305.
// libsodium's crypto_scalarmult is X25519 (clamping internally), matching Go's
// crypto/ecdh.X25519, so shared secrets agree byte-for-byte across the two apps.

export interface Wrapped {
  ephemeralPub: Uint8Array;
  nonce: Uint8Array;
  wrapped: Uint8Array;
}

/** wrapKey encrypts itemKey to recipientPub. Returns ephemeral pub, nonce, ct. */
export async function wrapKey(recipientPub: Uint8Array, itemKey: Uint8Array): Promise<Wrapped> {
  const ephPriv = sodium.randombytes_buf(32);
  const ephPub = sodium.crypto_scalarmult_base(ephPriv);
  const shared = sodium.crypto_scalarmult(ephPriv, recipientPub);
  const wrapKeyBytes = await deriveWrapKey(shared, ephPub, recipientPub);
  const { nonce, ciphertext } = seal(wrapKeyBytes, itemKey, null);
  return { ephemeralPub: ephPub, nonce, wrapped: ciphertext };
}

/** unwrapKey recovers an item key wrapped to the holder of recipientPriv. */
export async function unwrapKey(
  recipientPriv: Uint8Array,
  ephemeralPub: Uint8Array,
  nonce: Uint8Array,
  wrapped: Uint8Array,
): Promise<Uint8Array> {
  const shared = sodium.crypto_scalarmult(recipientPriv, ephemeralPub);
  const recipientPub = sodium.crypto_scalarmult_base(recipientPriv);
  const wrapKeyBytes = await deriveWrapKey(shared, ephemeralPub, recipientPub);
  return open(wrapKeyBytes, nonce, wrapped, null);
}

/**
 * deriveWrapKey derives a 32-byte key from the ECDH shared secret via HKDF.
 * Both public keys are mixed into the salt (ephemeralPub || recipientPub) so the
 * derived key is unique to this exchange.
 */
async function deriveWrapKey(
  shared: Uint8Array,
  ephemeralPub: Uint8Array,
  recipientPub: Uint8Array,
): Promise<Uint8Array> {
  const salt = new Uint8Array(ephemeralPub.length + recipientPub.length);
  salt.set(ephemeralPub, 0);
  salt.set(recipientPub, ephemeralPub.length);
  return hkdfSha256(shared, salt, utf8('cowbird-wrap-v1'), 32);
}
