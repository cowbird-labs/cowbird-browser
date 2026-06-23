import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initCrypto } from '../src/crypto/index';
import { newIdentity, type Identity } from '../src/crypto/identity';
import { MemoryKv } from '../src/vault/memory';
import { VaultNotFound } from '../src/vault/kv';
import { VaultStore } from '../src/vault/store';
import { Service } from '../src/sharing/service';
import { newID, signingBytes, signMessage, verifyMessage } from '../src/sharing/index';
import type { Content } from '../src/items/types';
import type { Message } from '../src/sharing/types';

beforeAll(async () => {
  await initCrypto();
});

const login = (password = 's3cr3t'): Content => ({
  kind: 'login',
  data: { title: 'GitHub', username: 'breaker1', password },
});

// Two users on one Vault: a single MemoryKv with two entity-scoped stores. The
// pubkeys/, shared/, and inbox/ subtrees are global; users/<id>/ is per-user.
let kv: MemoryKv;
let alice: Identity;
let bob: Identity;
let aliceSvc: Service;
let bobSvc: Service;
let aliceStore: VaultStore;
let bobStore: VaultStore;

beforeEach(async () => {
  kv = new MemoryKv();
  alice = newIdentity();
  bob = newIdentity();
  aliceStore = new VaultStore(kv, 'alice');
  bobStore = new VaultStore(kv, 'bob');
  await aliceStore.putPublicKey('alice', alice.encryptionPub, alice.signingPub, 'Alice');
  await bobStore.putPublicKey('bob', bob.encryptionPub, bob.signingPub, 'Bob');
  aliceSvc = new Service('alice', alice, aliceStore);
  bobSvc = new Service('bob', bob, bobStore);
});

async function shareIDFor(itemID: string): Promise<string> {
  const recs = await aliceStore.listShareRecords();
  const rec = recs.find((r) => r.itemID === itemID);
  if (!rec) throw new Error('no share record');
  return rec.shareID;
}

describe('own items', () => {
  it('creates, opens, and updates an owned item', async () => {
    const env = await aliceSvc.createItem(login());
    expect(await aliceSvc.openOwnItem(env)).toEqual(login());

    await aliceSvc.updateItem(env.id, login('rotated-pw'));
    const reloaded = (await aliceSvc.listItems()).find((e) => e.id === env.id)!;
    expect(await aliceSvc.openOwnItem(reloaded)).toEqual(login('rotated-pw'));
  });
});

describe('sharing protocol', () => {
  it('shares an item; the recipient links it and can decrypt it', async () => {
    const env = await aliceSvc.createItem(login());
    await aliceSvc.share(env.id, 'bob');

    await bobSvc.processInbox();
    const links = await bobSvc.listSharedLinks();
    expect(links).toHaveLength(1);
    expect(await bobSvc.openSharedItem(links[0]!)).toEqual(login());
  });

  it('propagates owner edits to the recipient without re-sharing', async () => {
    const env = await aliceSvc.createItem(login());
    await aliceSvc.share(env.id, 'bob');
    await bobSvc.processInbox();
    const link = (await bobSvc.listSharedLinks())[0]!;

    await aliceSvc.updateItem(env.id, login('edited-pw'));
    // No new inbox message is needed: the link still points at the (rewritten)
    // shared envelope, encrypted under the same item key.
    expect(await bobSvc.openSharedItem(link)).toEqual(login('edited-pw'));
  });

  it('is idempotent across repeated inbox processing', async () => {
    const env = await aliceSvc.createItem(login());
    await aliceSvc.share(env.id, 'bob');
    await bobSvc.processInbox();
    await bobSvc.processInbox();
    expect(await bobSvc.listSharedLinks()).toHaveLength(1);
  });

  it('revokes access: the link is dropped and the copy disappears', async () => {
    const env = await aliceSvc.createItem(login());
    await aliceSvc.share(env.id, 'bob');
    await bobSvc.processInbox();
    const link = (await bobSvc.listSharedLinks())[0]!;
    const shareID = await shareIDFor(env.id);

    await aliceSvc.revoke(shareID, 'bob');
    await bobSvc.processInbox();
    expect(await bobSvc.listSharedLinks()).toHaveLength(0);
    await expect(bobSvc.openSharedItem(link)).rejects.toBeInstanceOf(VaultNotFound);
  });

  it('rejects a forged (unsigned) revoke and keeps the link', async () => {
    const env = await aliceSvc.createItem(login());
    await aliceSvc.share(env.id, 'bob');
    await bobSvc.processInbox();
    const shareID = await shareIDFor(env.id);

    // Anyone can write to bob's inbox; a revoke that isn't signed by alice (who
    // has a published signing key) is a downgrade and must be discarded.
    const forged: Message = {
      type: 'revoke',
      shareID,
      senderID: 'mallory',
      envVersion: 0,
      timestamp: new Date().toISOString(),
      signature: new Uint8Array(0),
    };
    await bobStore.sendMessage('bob', newID(), forged);

    await bobSvc.processInbox();
    expect(await bobSvc.listSharedLinks()).toHaveLength(1);
  });
});

describe('share path validation', () => {
  it('discards a share whose path tries to traverse out of its subtree', async () => {
    // Anyone can write to bob's inbox. A hostile share whose shareID segment
    // carries traversal/metacharacters must be rejected before its raw path is
    // stored or concatenated into a Vault KV URL.
    const hostile: Message = {
      type: 'share',
      shareID: 'mallory',
      senderID: 'mallory',
      envVersion: 1,
      timestamp: new Date().toISOString(),
      share: {
        sharePath: 'mallory/../../pubkeys/alice',
        wrappedKey: new Uint8Array([1, 2, 3]),
        itemType: 'login',
        ownerID: 'mallory',
      },
      signature: new Uint8Array(0),
    };
    await bobStore.sendMessage('bob', newID(), hostile);

    await bobSvc.processInbox();
    expect(await bobSvc.listSharedLinks()).toHaveLength(0);
    // The message is consumed, not left to wedge the inbox.
    expect(await bobStore.listInboxMessages()).toHaveLength(0);
  });

  it('rejects a malformed shareID at the store path boundary', async () => {
    await expect(bobStore.getSharedEnvelope('alice', '../alice/items/secret')).rejects.toThrow(
      /invalid/,
    );
  });
});

describe('message signing', () => {
  it('signs and verifies a share message, and rejects tampering', async () => {
    const msg: Message = {
      type: 'share',
      shareID: 's1',
      senderID: 'alice',
      envVersion: 5,
      timestamp: new Date().toISOString(),
      share: {
        sharePath: 'alice/s1',
        wrappedKey: new Uint8Array([1, 2, 3]),
        itemType: 'login',
        ownerID: 'alice',
      },
      signature: new Uint8Array(0),
    };
    signMessage(alice, msg);
    expect(msg.signature.length).toBe(64);
    expect(await verifyMessage(aliceStore, 'alice', msg)).toEqual({ ok: true, legacy: false });

    // Tamper with an authenticated field: verification must fail.
    const tampered: Message = { ...msg, envVersion: 6 };
    expect(await verifyMessage(aliceStore, 'alice', tampered)).toEqual({ ok: false, legacy: false });
  });

  it('reports legacy when the claimed signer has no published signing key', async () => {
    const legacyStore = new VaultStore(kv, 'carol');
    await legacyStore.putPublicKey('carol', newIdentity().encryptionPub, new Uint8Array(0), 'Carol');
    const msg: Message = {
      type: 'revoke',
      shareID: 's1',
      senderID: 'carol',
      envVersion: 0,
      timestamp: new Date().toISOString(),
      signature: new Uint8Array(0),
    };
    expect(await verifyMessage(aliceStore, 'carol', msg)).toEqual({ ok: false, legacy: true });
  });

  it('produces deterministic signing bytes', () => {
    const msg: Message = {
      type: 'revoke',
      shareID: 'abc',
      senderID: 'x',
      envVersion: 9,
      timestamp: 'whatever',
      signature: new Uint8Array(0),
    };
    expect(signingBytes(msg)).toEqual(signingBytes({ ...msg, senderID: 'y', timestamp: 'other' }));
  });
});
