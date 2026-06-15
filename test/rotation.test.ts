import { beforeAll, describe, expect, it } from 'vitest';
import { initCrypto, utf8 } from '../src/crypto/index';
import { newIdentity } from '../src/crypto/identity';
import { MemoryKv } from '../src/vault/memory';
import { VaultNotFound } from '../src/vault/kv';
import { VaultStore } from '../src/vault/store';
import { VaultHttp } from '../src/vault/http';
import { Service } from '../src/sharing/service';
import { initIdentity } from '../src/core/identity';
import { App } from '../src/core/app';
import { rotateKey } from '../src/core/rotation';
import type { VaultSession } from '../src/core/session';
import type { Content } from '../src/items/types';

beforeAll(async () => {
  await initCrypto();
});

const login: Content = { kind: 'login', data: { title: 'GitHub', username: 'breaker1', password: 's3cr3t' } };

function session(store: VaultStore, entityID: string, displayName: string): VaultSession {
  return { http: new VaultHttp('http://vault.invalid'), store, token: '', entityID, displayName, mount: 'cowbird' };
}

describe('key rotation', () => {
  it('re-keys owned items and redistributes shares, then destroys the old key', async () => {
    const kv = new MemoryKv();
    const aliceStore = new VaultStore(kv, 'alice');
    const bobStore = new VaultStore(kv, 'bob');
    const bob = newIdentity();
    await bobStore.putPublicKey('bob', bob.encryptionPub, bob.signingPub, 'Bob');

    const aliceId = await initIdentity(aliceStore, utf8('pw'), 'Alice');
    const app = new App(session(aliceStore, 'alice', 'Alice'), aliceId);
    const bobSvc = new Service('bob', bob, bobStore);

    const env = await app.service.createItem(login);
    await app.service.share(env.id, 'bob');
    await bobSvc.processInbox();
    expect(await bobSvc.openSharedItem((await bobSvc.listSharedLinks())[0]!)).toEqual(login);

    const originalFingerprint = app.identity.fingerprint;
    await rotateKey(app, utf8('pw'), 'Alice');

    // The keypair changed and is now the published one; the old key is gone.
    expect(app.identity.fingerprint).not.toBe(originalFingerprint);
    expect(await aliceStore.getPublicKey('alice')).toEqual(app.identity.encryptionPub);
    await expect(aliceStore.getPrevLockedIdentity()).rejects.toBeInstanceOf(VaultNotFound);

    // Alice still reads her own item; bob regains access after processing the
    // redistributed share message.
    const reloaded = (await app.service.listItems()).find((e) => e.id === env.id)!;
    expect(await app.service.openOwnItem(reloaded)).toEqual(login);

    await bobSvc.processInbox();
    expect(await bobSvc.openSharedItem((await bobSvc.listSharedLinks())[0]!)).toEqual(login);
  });
});
