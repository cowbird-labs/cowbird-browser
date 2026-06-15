import { sodium } from './sodium';
import { seal, open } from './aead';
import { deriveUnlockKey, generateSalt, CURRENT_KDF_VERSION } from './kdf';
import { b64encode, b64decode, utf8, fromUtf8 } from './b64';

// Mirrors internal/crypto/identity.go.
//
// An Identity holds a user's keypair material in memory; private fields are
// populated only after unlock. Go's ed25519 private key is 64 bytes (seed||pub),
// which is exactly libsodium's secret-key layout, so signing keys interoperate.

export interface Identity {
  signingPub: Uint8Array; // ed25519 public key (32 bytes); empty if none
  signingPriv: Uint8Array; // ed25519 private key (64 bytes); empty if none
  encryptionPub: Uint8Array; // X25519 public key (32 bytes)
  encryptionPriv: Uint8Array; // X25519 private key (32 bytes)
  fingerprint: string; // hex-encoded SHA-256 of encryptionPub
}

/**
 * LockedIdentity is an Identity's private keys encrypted under an Argon2id-derived
 * key — the at-rest form in Vault. version records the KDF parameter set used;
 * 0 (absent) denotes a pre-versioning record read as kdfV1.
 */
export interface LockedIdentity {
  version: number;
  salt: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

const ED25519_SK_BYTES = 64;

function fingerprint(pub: Uint8Array): string {
  return sodium.to_hex(sodium.crypto_hash_sha256(pub));
}

/** newIdentity generates a fresh X25519 encryption keypair and Ed25519 signing keypair. */
export function newIdentity(): Identity {
  const encryptionPriv = sodium.randombytes_buf(32);
  const encryptionPub = sodium.crypto_scalarmult_base(encryptionPriv);
  const sig = sodium.crypto_sign_keypair();
  return {
    signingPub: sig.publicKey,
    signingPriv: sig.privateKey,
    encryptionPub,
    encryptionPriv,
    fingerprint: fingerprint(encryptionPub),
  };
}

/** lockedKeys is the plaintext sealed inside a LockedIdentity. */
interface LockedKeysJSON {
  enc_priv: string;
  sig_priv?: string;
}

/** lockIdentity encrypts the identity's private keys under password. */
export async function lockIdentity(id: Identity, password: Uint8Array): Promise<LockedIdentity> {
  const salt = generateSalt();
  const keys: LockedKeysJSON = { enc_priv: b64encode(id.encryptionPriv) };
  if (id.signingPriv.length > 0) keys.sig_priv = b64encode(id.signingPriv);
  const plaintext = utf8(JSON.stringify(keys));
  const encKey = await deriveUnlockKey(password, salt, CURRENT_KDF_VERSION);
  const { nonce, ciphertext } = seal(encKey, plaintext, null);
  return { version: CURRENT_KDF_VERSION, salt, nonce, ciphertext };
}

/** unlockIdentity decrypts a LockedIdentity and reconstructs the Identity. */
export async function unlockIdentity(
  locked: LockedIdentity,
  password: Uint8Array,
): Promise<Identity> {
  const encKey = await deriveUnlockKey(password, locked.salt, locked.version);
  let plaintext: Uint8Array;
  try {
    plaintext = open(encKey, locked.nonce, locked.ciphertext, null);
  } catch {
    throw new Error('incorrect password or corrupted key material');
  }
  const keys = JSON.parse(fromUtf8(plaintext)) as LockedKeysJSON;
  const encryptionPriv = b64decode(keys.enc_priv);
  // Derive the public key from the private key so it is always consistent.
  const encryptionPub = sodium.crypto_scalarmult_base(encryptionPriv);
  let signingPriv: Uint8Array = new Uint8Array(0);
  let signingPub: Uint8Array = new Uint8Array(0);
  if (keys.sig_priv) {
    signingPriv = b64decode(keys.sig_priv);
    signingPub = sodium.crypto_sign_ed25519_sk_to_pk(signingPriv);
  }
  return {
    signingPub,
    signingPriv,
    encryptionPub,
    encryptionPriv,
    fingerprint: fingerprint(encryptionPub),
  };
}

/**
 * identityFromPrivateKeys reconstructs an Identity from its stored private keys,
 * deriving the public keys and fingerprint. Used to rehydrate an unlocked
 * session in the background worker after a service-worker restart, without the
 * unlock password (only the already-decrypted private keys are kept, in
 * in-memory session storage).
 */
export function identityFromPrivateKeys(
  encryptionPriv: Uint8Array,
  signingPriv: Uint8Array,
): Identity {
  const encryptionPub = sodium.crypto_scalarmult_base(encryptionPriv);
  let signingPub: Uint8Array = new Uint8Array(0);
  if (signingPriv.length > 0) signingPub = sodium.crypto_sign_ed25519_sk_to_pk(signingPriv);
  return {
    signingPub,
    signingPriv,
    encryptionPub,
    encryptionPriv,
    fingerprint: fingerprint(encryptionPub),
  };
}

/**
 * ensureSigningKey attaches a fresh Ed25519 keypair if the identity has none —
 * the migration path for identities created before signing keys existed. Returns
 * whether a key was added (the caller then persists and re-publishes).
 */
export function ensureSigningKey(id: Identity): boolean {
  if (id.signingPriv.length === ED25519_SK_BYTES) return false;
  const sig = sodium.crypto_sign_keypair();
  id.signingPub = sig.publicKey;
  id.signingPriv = sig.privateKey;
  return true;
}
