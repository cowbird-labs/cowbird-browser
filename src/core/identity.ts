import {
  newIdentity,
  lockIdentity,
  unlockIdentity,
  ensureSigningKey,
  type Identity,
} from '../crypto/identity';
import { needsKDFUpgrade } from '../crypto/kdf';
import { exportKey, importKey } from '../crypto/export';
import { VaultNotFound } from '../vault/kv';
import type { VaultStore } from '../vault/store';

// Mirrors internal/core/core.go (identity lifecycle). Key rotation
// (RotateKey/completeInterruptedRotation) needs the sharing service and lands in
// a later milestone; initIdentity refuses to proceed past a pending rotation
// unless a completer is supplied, rather than silently ignoring it.

/** completeRotation finishes an interrupted key rotation; injected by the sharing layer. */
export type RotationCompleter = (
  store: VaultStore,
  canonical: Identity,
  password: Uint8Array,
) => Promise<void>;

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function hasPendingRotation(store: VaultStore): Promise<boolean> {
  try {
    await store.getPrevLockedIdentity();
    return true;
  } catch (err) {
    if (err instanceof VaultNotFound) return false;
    throw err;
  }
}

/**
 * initIdentity creates (first run) or unlocks the user's identity. On unlock it
 * runs the password-in-hand migrations — minting a signing key for pre-008
 * identities and upgrading the KDF parameters — then re-publishes the public key
 * so the directory entry carries the current display name and signing key.
 */
export async function initIdentity(
  store: VaultStore,
  password: Uint8Array,
  displayName: string,
  completeRotation?: RotationCompleter,
): Promise<Identity> {
  let locked;
  try {
    locked = await store.getLockedIdentity();
  } catch (err) {
    if (err instanceof VaultNotFound) return createIdentity(store, password, displayName);
    throw err;
  }

  const id = await unlockIdentity(locked, password);

  const addedSigningKey = ensureSigningKey(id);
  if (addedSigningKey || needsKDFUpgrade(locked.version)) {
    await store.putLockedIdentity(await lockIdentity(id, password));
  }

  if (completeRotation) {
    await completeRotation(store, id, password);
  } else if (await hasPendingRotation(store)) {
    throw new Error(
      'a key rotation is in progress; finish it in the desktop app (in-extension rotation lands in a later milestone)',
    );
  }

  await store.putPublicKey(store.entityID, id.encryptionPub, id.signingPub, displayName);
  return id;
}

async function createIdentity(
  store: VaultStore,
  password: Uint8Array,
  displayName: string,
): Promise<Identity> {
  const id = newIdentity();
  await store.putLockedIdentity(await lockIdentity(id, password));
  await store.putPublicKey(store.entityID, id.encryptionPub, id.signingPub, displayName);
  return id;
}

/**
 * changePassword re-wraps the locked identity under a new unlock password. The
 * keypair is unchanged, so no item contents are re-encrypted and recipients'
 * wrapped keys stay valid.
 */
export async function changePassword(
  store: VaultStore,
  oldPassword: Uint8Array,
  newPassword: Uint8Array,
): Promise<void> {
  let locked;
  try {
    locked = await store.getLockedIdentity();
  } catch (err) {
    if (err instanceof VaultNotFound) throw new Error('no identity to change the password for');
    throw err;
  }
  const id = await unlockIdentity(locked, oldPassword); // verifies old password
  await store.putLockedIdentity(await lockIdentity(id, newPassword));
}

/**
 * exportIdentity produces a passphrase-protected recovery file, gated behind the
 * current unlock password. Nothing is written to Vault.
 */
export async function exportIdentity(
  store: VaultStore,
  unlockPassword: Uint8Array,
  exportPassphrase: Uint8Array,
): Promise<Uint8Array> {
  const locked = await store.getLockedIdentity();
  const id = await unlockIdentity(locked, unlockPassword);
  return exportKey(id, exportPassphrase);
}

/** Thrown by importIdentity when the recovery file's key differs from the
 * published public key; retry with force=true after confirming with the user. */
export const ERR_IDENTITY_MISMATCH = 'recovery file is for a different identity';

/**
 * importIdentity restores a keypair from a recovery file and installs it as the
 * Vault-stored locked identity under a new unlock password. It refuses to
 * overwrite a different published identity unless force is set.
 */
export async function importIdentity(
  store: VaultStore,
  data: Uint8Array,
  exportPassphrase: Uint8Array,
  newUnlockPassword: Uint8Array,
  displayName: string,
  force = false,
): Promise<Identity> {
  const id = await importKey(data, exportPassphrase);
  ensureSigningKey(id);

  let existingPub: Uint8Array | null = null;
  try {
    existingPub = await store.getPublicKey(store.entityID);
  } catch (err) {
    if (!(err instanceof VaultNotFound)) throw err;
  }
  if (existingPub && !bytesEqual(existingPub, id.encryptionPub) && !force) {
    throw new Error(ERR_IDENTITY_MISMATCH);
  }

  await store.putLockedIdentity(await lockIdentity(id, newUnlockPassword));
  // Clear any stale rotation marker: it is locked under the old unlock password
  // and would otherwise block the next unlock.
  try {
    await store.deletePrevLockedIdentity();
  } catch (err) {
    if (!(err instanceof VaultNotFound)) throw err;
  }
  await store.putPublicKey(store.entityID, id.encryptionPub, id.signingPub, displayName);
  return id;
}
