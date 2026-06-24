import { newItemKey } from './item';
import { seal, open } from './aead';
import { wrapKey, unwrapKey } from './wrap';
import type { Identity } from './identity';

// Mirrors internal/crypto/self.go.
//
// SelfSealed is a blob encrypted to the holder's own X25519 key, decryptable with
// their in-memory private key (no password prompt). It is a single-recipient-to-
// self envelope: a random content key encrypts the plaintext and is itself wrapped
// to the owner's public key. Used for per-user metadata records (the organization
// overlay of favorites and labels) that must stay private to the user and opaque
// to the storage operator. Authenticated (XChaCha20-Poly1305), so operator
// tampering fails closed. Reuses the same wrap/seal primitives as item sharing, so
// blobs are byte-compatible with the Go desktop app.

export interface SelfSealed {
  ephemeralPub: Uint8Array; // wrap ECDH ephemeral public key
  wrapNonce: Uint8Array; // nonce for the wrapped content key
  wrappedKey: Uint8Array; // content key wrapped to own public key
  nonce: Uint8Array; // content nonce
  ciphertext: Uint8Array; // plaintext sealed under the content key
}

/** sealToSelf encrypts plaintext to the identity's own X25519 public key. */
export async function sealToSelf(id: Identity, plaintext: Uint8Array): Promise<SelfSealed> {
  const contentKey = newItemKey();
  const { nonce, ciphertext } = seal(contentKey, plaintext, null);
  const { ephemeralPub, nonce: wrapNonce, wrapped } = await wrapKey(id.encryptionPub, contentKey);
  return { ephemeralPub, wrapNonce, wrappedKey: wrapped, nonce, ciphertext };
}

/**
 * openFromSelf decrypts a SelfSealed blob with the identity's private key.
 * Throws a generic error on failure (wrong key or tampering).
 */
export async function openFromSelf(id: Identity, b: SelfSealed): Promise<Uint8Array> {
  const contentKey = await unwrapKey(id.encryptionPriv, b.ephemeralPub, b.wrapNonce, b.wrappedKey);
  return open(contentKey, b.nonce, b.ciphertext, null);
}
