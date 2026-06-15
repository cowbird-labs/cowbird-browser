import { beforeAll, describe, expect, it } from 'vitest';
import { initCrypto, utf8, b64encode } from '../src/crypto/index';
import { lockIdentity, newIdentity } from '../src/crypto/identity';
import { MemoryKv } from '../src/vault/memory';
import { VaultStore } from '../src/vault/store';
import {
  initIdentity,
  changePassword,
  exportIdentity,
  importIdentity,
  ERR_IDENTITY_MISMATCH,
} from '../src/core/identity';

beforeAll(async () => {
  await initCrypto();
});

function freshStore(): VaultStore {
  return new VaultStore(new MemoryKv(), 'entity-A');
}

describe('initIdentity', () => {
  it('creates on first run and unlocks the same keypair afterwards', async () => {
    const store = freshStore();
    const created = await initIdentity(store, utf8('pw'), 'Alice');
    // The public key is published under the entity id.
    expect(await store.getPublicKey('entity-A')).toEqual(created.encryptionPub);

    const unlocked = await initIdentity(store, utf8('pw'), 'Alice');
    expect(b64encode(unlocked.encryptionPriv)).toBe(b64encode(created.encryptionPriv));
    expect(unlocked.fingerprint).toBe(created.fingerprint);
  });

  it('rejects a wrong password', async () => {
    const store = freshStore();
    await initIdentity(store, utf8('right'), 'Alice');
    await expect(initIdentity(store, utf8('wrong'), 'Alice')).rejects.toThrow(
      'incorrect password',
    );
  });

  it('refuses to proceed past a pending rotation without a completer', async () => {
    const store = freshStore();
    await initIdentity(store, utf8('pw'), 'Alice');
    // Simulate an interrupted rotation by staging a prev identity.
    await store.putPrevLockedIdentity(await lockIdentity(newIdentity(), utf8('pw')));
    await expect(initIdentity(store, utf8('pw'), 'Alice')).rejects.toThrow('key rotation');
  });
});

describe('changePassword', () => {
  it('re-wraps under a new password without changing the keypair', async () => {
    const store = freshStore();
    const id = await initIdentity(store, utf8('old'), 'Alice');
    await changePassword(store, utf8('old'), utf8('new'));
    await expect(initIdentity(store, utf8('old'), 'Alice')).rejects.toThrow('incorrect password');
    const reunlocked = await initIdentity(store, utf8('new'), 'Alice');
    expect(b64encode(reunlocked.encryptionPriv)).toBe(b64encode(id.encryptionPriv));
  });
});

describe('export / import identity', () => {
  it('exports a recovery file and re-imports it under a new password', async () => {
    const store = freshStore();
    const id = await initIdentity(store, utf8('unlock'), 'Alice');
    const file = await exportIdentity(store, utf8('unlock'), utf8('passphrase'));

    const restored = await importIdentity(store, file, utf8('passphrase'), utf8('new-unlock'), 'Alice');
    expect(restored.fingerprint).toBe(id.fingerprint);
    const reunlocked = await initIdentity(store, utf8('new-unlock'), 'Alice');
    expect(b64encode(reunlocked.encryptionPriv)).toBe(b64encode(id.encryptionPriv));
  });

  it('refuses to import a different identity unless forced', async () => {
    const store = freshStore();
    await initIdentity(store, utf8('unlock'), 'Alice'); // publishes entity-A's key
    // A recovery file for a *different* identity.
    const other = newIdentity();
    const { exportKey } = await import('../src/crypto/export');
    const foreignFile = await exportKey(other, utf8('pp'));
    await expect(
      importIdentity(store, foreignFile, utf8('pp'), utf8('nu'), 'Alice'),
    ).rejects.toThrow(ERR_IDENTITY_MISMATCH);
    // force overrides.
    const forced = await importIdentity(store, foreignFile, utf8('pp'), utf8('nu'), 'Alice', true);
    expect(forced.fingerprint).toBe(other.fingerprint);
  });
});
