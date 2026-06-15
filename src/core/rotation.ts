import {
  lockIdentity,
  newIdentity,
  unlockIdentity,
  type Identity,
} from '../crypto/identity';
import { Service } from '../sharing/service';
import { VaultNotFound } from '../vault/kv';
import type { VaultStore } from '../vault/store';
import type { App } from './app';
import type { RotationCompleter } from './identity';

// Mirrors the key-rotation logic in internal/core/core.go. A rotation is staged
// (old key written to a transitional slot before the new key becomes canonical)
// so an interruption is recoverable: completeInterruptedRotation finishes any
// staged rotation and is run on every unlock.

/**
 * completeInterruptedRotation finishes a rotation if the transitional slot is
 * present. `canonical` is the already-unlocked canonical identity (the new
 * keypair when a rotation is mid-flight). No-op when none is in progress, and
 * idempotent so it can run at every unlock.
 */
export async function completeInterruptedRotation(
  store: VaultStore,
  canonical: Identity,
  password: Uint8Array,
  displayName: string,
): Promise<void> {
  let prevLocked;
  try {
    prevLocked = await store.getPrevLockedIdentity();
  } catch (err) {
    if (err instanceof VaultNotFound) return;
    throw err;
  }
  const oldID = await unlockIdentity(prevLocked, password);

  // Aborted before the new key was committed: canonical and prev are the same
  // keypair, nothing was migrated. Discard the stale slot and stop.
  if (oldID.fingerprint === canonical.fingerprint) {
    await store.deletePrevLockedIdentity();
    return;
  }

  // Publish the new public key so future shares target it, then re-key every
  // owned item and re-distribute shares using the old key to read.
  await store.putPublicKey(store.entityID, canonical.encryptionPub, canonical.signingPub, displayName);
  const svc = new Service(store.entityID, canonical, store);
  await svc.rekey(oldID.encryptionPriv, canonical.encryptionPriv, canonical.encryptionPub);
  await store.deletePrevLockedIdentity();
}

/** rotationCompleter adapts completeInterruptedRotation to the RotationCompleter
 * shape initIdentity expects, capturing the display name. */
export function rotationCompleter(displayName: string): RotationCompleter {
  return (store, canonical, password) =>
    completeInterruptedRotation(store, canonical, password, displayName);
}

/**
 * rotateKey rotates the user's encryption keypair for compromise recovery. A
 * new keypair is generated; every owned item is re-encrypted under a fresh item
 * key wrapped to it, shares are re-distributed to recipients' current keys, the
 * new public key is published, and the old keypair is destroyed. Staged so an
 * interruption is recoverable; a rotation already in progress is finished rather
 * than restarted.
 */
export async function rotateKey(app: App, password: Uint8Array, displayName: string): Promise<void> {
  const store = app.session.store;

  const locked = await store.getLockedIdentity();
  const canonical = await unlockIdentity(locked, password);

  // A transitional slot means a prior rotation did not finish; the canonical
  // identity is already the new one, so just complete it.
  let pending = false;
  try {
    await store.getPrevLockedIdentity();
    pending = true;
  } catch (err) {
    if (!(err instanceof VaultNotFound)) throw err;
  }
  if (pending) {
    await completeInterruptedRotation(store, canonical, password, displayName);
    app.adoptIdentity(canonical);
    return;
  }

  const next = newIdentity();
  // Stage the old key first, then make the new key canonical.
  await store.putPrevLockedIdentity(locked);
  await store.putLockedIdentity(await lockIdentity(next, password));

  await completeInterruptedRotation(store, next, password, displayName);
  app.adoptIdentity(next);
}
