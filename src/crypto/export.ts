import { lockIdentity, unlockIdentity, type Identity, type LockedIdentity } from './identity';
import { b64encode, b64decode, utf8, fromUtf8 } from './b64';

// Mirrors internal/crypto/export.go. The passphrase-protected recovery file is
// the only device-loss recovery mechanism. version is the file format version;
// kdf_version is the Argon2id parameter set used to derive the encryption key
// (0/absent = kdfV1, for files written before KDF versioning).

const EXPORT_VERSION = 1;

interface ExportedKeyJSON {
  version: number;
  kdf_version?: number;
  salt: string;
  nonce: string;
  ciphertext: string;
}

/** exportKey serializes and encrypts the identity's private keys under passphrase. */
export async function exportKey(id: Identity, passphrase: Uint8Array): Promise<Uint8Array> {
  const locked = await lockIdentity(id, passphrase);
  const exported: ExportedKeyJSON = {
    version: EXPORT_VERSION,
    salt: b64encode(locked.salt),
    nonce: b64encode(locked.nonce),
    ciphertext: b64encode(locked.ciphertext),
  };
  if (locked.version !== 0) exported.kdf_version = locked.version;
  return utf8(JSON.stringify(exported));
}

/** importKey parses and decrypts an exported key file, restoring the Identity. */
export async function importKey(data: Uint8Array, passphrase: Uint8Array): Promise<Identity> {
  const exported = JSON.parse(fromUtf8(data)) as ExportedKeyJSON;
  if (exported.version !== EXPORT_VERSION) {
    throw new Error(`unsupported export version ${exported.version}`);
  }
  const locked: LockedIdentity = {
    version: exported.kdf_version ?? 0,
    salt: b64decode(exported.salt),
    nonce: b64decode(exported.nonce),
    ciphertext: b64decode(exported.ciphertext),
  };
  return unlockIdentity(locked, passphrase);
}
