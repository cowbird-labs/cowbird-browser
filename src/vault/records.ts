import { b64encode, b64decode } from '../crypto/b64';
import type { LockedIdentity } from '../crypto/identity';
import type { PublicKeyEntry } from '../sharing/types';

// At-rest JSON shapes for records the core layer reads/writes directly:
// the locked identity (crypto.LockedIdentity) and the public-key directory
// entry (vault.pubkeyRecord). Tags/omitempty match the Go structs.

interface LockedIdentityWire {
  version?: number;
  salt: string;
  nonce: string;
  ciphertext: string;
}

export function lockedIdentityToWire(l: LockedIdentity): LockedIdentityWire {
  const w: LockedIdentityWire = {
    salt: b64encode(l.salt),
    nonce: b64encode(l.nonce),
    ciphertext: b64encode(l.ciphertext),
  };
  if (l.version !== 0) w.version = l.version;
  return w;
}

export function lockedIdentityFromWire(w: LockedIdentityWire): LockedIdentity {
  return {
    version: w.version ?? 0,
    salt: b64decode(w.salt),
    nonce: b64decode(w.nonce),
    ciphertext: b64decode(w.ciphertext),
  };
}

/**
 * pubkeyRecord is the at-rest form of a user's published keys. pub is the
 * 32-byte X25519 key; sig_pub the Ed25519 signing key (added in 008); name the
 * advisory display name (added in 003). Records published before each field
 * unmarshal with that field empty.
 */
export interface PubkeyRecordWire {
  pub: string;
  sig_pub?: string;
  name?: string;
}

export function pubkeyRecordToWire(
  pub: Uint8Array,
  sigPub: Uint8Array,
  name: string,
): PubkeyRecordWire {
  const w: PubkeyRecordWire = { pub: b64encode(pub) };
  if (sigPub.length > 0) w.sig_pub = b64encode(sigPub);
  if (name.length > 0) w.name = name;
  return w;
}

export function publicKeyEntryFromWire(entityID: string, w: PubkeyRecordWire): PublicKeyEntry {
  return {
    entityID,
    pub: b64decode(w.pub),
    sigPub: w.sig_pub ? b64decode(w.sig_pub) : new Uint8Array(0),
    name: w.name ?? '',
  };
}
