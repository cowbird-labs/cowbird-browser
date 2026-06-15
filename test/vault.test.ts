import { beforeAll, describe, expect, it } from 'vitest';
import { initCrypto } from '../src/crypto/index';
import { MemoryKv } from '../src/vault/memory';
import { VaultNotFound } from '../src/vault/kv';
import { VaultStore } from '../src/vault/store';
import {
  envelopeToWire,
  envelopeFromWire,
  messageToWire,
  messageFromWire,
  sharedLinkToWire,
  sharedLinkFromWire,
  marshalWrappedKey,
  unmarshalWrappedKey,
} from '../src/sharing/wire';
import type { Envelope, Message, SharedLink, WrappedKey } from '../src/sharing/types';

beforeAll(async () => {
  await initCrypto();
});

const bytes = (...n: number[]) => new Uint8Array(n);

function sampleWrappedKey(id = 'r1'): WrappedKey {
  return { recipientID: id, ephemeralPub: bytes(1, 2, 3), nonce: bytes(4, 5), wrapped: bytes(6, 7, 8) };
}

function sampleEnvelope(): Envelope {
  return {
    id: 'item-1',
    type: 'login',
    ownerID: 'owner-1',
    format: 1,
    recipients: [sampleWrappedKey('owner-1')],
    nonce: bytes(9, 9, 9),
    ciphertext: bytes(10, 11, 12, 13),
    signature: new Uint8Array(0),
  };
}

describe('sharing wire round-trips', () => {
  it('round-trips an envelope (format/recipients/signature omitempty)', () => {
    const env = sampleEnvelope();
    expect(envelopeFromWire(envelopeToWire(env) as never)).toEqual(env);
  });

  it('omits format when 0 and recipients when empty', () => {
    const env: Envelope = { ...sampleEnvelope(), format: 0, recipients: [] };
    const wire = envelopeToWire(env) as unknown as Record<string, unknown>;
    expect('format' in wire).toBe(false);
    expect('recipients' in wire).toBe(false);
    expect('signature' in wire).toBe(false);
  });

  it('round-trips a share message and a revoke message', () => {
    const share: Message = {
      type: 'share',
      shareID: 's1',
      senderID: 'sender',
      envVersion: 7,
      timestamp: '2026-06-15T00:00:00Z',
      share: {
        sharePath: 'owner-1/s1',
        wrappedKey: marshalWrappedKey(sampleWrappedKey()),
        itemType: 'login',
        ownerID: 'owner-1',
      },
      signature: bytes(20, 21),
    };
    expect(messageFromWire(messageToWire(share) as never)).toEqual(share);

    const revoke: Message = {
      type: 'revoke',
      shareID: 's1',
      senderID: 'sender',
      envVersion: 8,
      timestamp: '2026-06-15T00:00:00Z',
      signature: new Uint8Array(0),
    };
    expect(messageFromWire(messageToWire(revoke) as never)).toEqual(revoke);
  });

  it('round-trips a shared link', () => {
    const link: SharedLink = {
      shareID: 's1',
      sharePath: 'owner-1/s1',
      wrappedKey: marshalWrappedKey(sampleWrappedKey()),
      ownerID: 'owner-1',
      itemType: 'login',
      envVersion: 3,
    };
    expect(sharedLinkFromWire(sharedLinkToWire(link) as never)).toEqual(link);
  });

  it('round-trips a marshaled WrappedKey (the nested []byte form)', () => {
    const wk = sampleWrappedKey();
    expect(unmarshalWrappedKey(marshalWrappedKey(wk))).toEqual(wk);
  });
});

describe('VaultStore over MemoryKv', () => {
  const store = new VaultStore(new MemoryKv(), 'entity-A');

  it('round-trips an owned item and lists it', async () => {
    await store.putItem('item-1', sampleEnvelope());
    expect(await store.getItem('item-1')).toEqual(sampleEnvelope());
    expect(await store.listItems()).toEqual([sampleEnvelope()]);
  });

  it('throws VaultNotFound for a missing item', async () => {
    await expect(store.getItem('nope')).rejects.toBeInstanceOf(VaultNotFound);
  });

  it('publishes and reads public keys, and rejects an absent signing key', async () => {
    await store.putPublicKey('entity-A', bytes(1, 2, 3), bytes(4, 5, 6), 'Alice');
    expect(await store.getPublicKey('entity-A')).toEqual(bytes(1, 2, 3));
    expect(await store.getSigningKey('entity-A')).toEqual(bytes(4, 5, 6));

    await store.putPublicKey('entity-B', bytes(7, 8), new Uint8Array(0), '');
    await expect(store.getSigningKey('entity-B')).rejects.toBeInstanceOf(VaultNotFound);

    const dir = await store.listPublicKeys();
    expect(dir.map((e) => e.entityID).sort()).toEqual(['entity-A', 'entity-B']);
  });

  it('returns the storage version for shared envelopes', async () => {
    const v1 = await store.putSharedEnvelope('s1', sampleEnvelope());
    const v2 = await store.putSharedEnvelope('s1', sampleEnvelope());
    expect(v2).toBe(v1 + 1);
    const { env, version } = await store.getSharedEnvelope('entity-A', 's1');
    expect(env).toEqual(sampleEnvelope());
    expect(version).toBe(v2);
  });

  it('handles the inbox: send, list, delete', async () => {
    const msg: Message = {
      type: 'share',
      shareID: 's9',
      senderID: 'entity-A',
      envVersion: 1,
      timestamp: '2026-06-15T00:00:00Z',
      share: {
        sharePath: 'entity-A/s9',
        wrappedKey: marshalWrappedKey(sampleWrappedKey('entity-A')),
        itemType: 'login',
        ownerID: 'entity-A',
      },
      signature: new Uint8Array(0),
    };
    await store.sendMessage('entity-A', 'msg-1', msg);
    const inbox = await store.listInboxMessages();
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.id).toBe('msg-1');
    expect(inbox[0]!.msg).toEqual(msg);
    await store.deleteInboxMessage('msg-1');
    expect(await store.listInboxMessages()).toHaveLength(0);
  });

  it('stores and clears the prev locked identity', async () => {
    const locked = { version: 2, salt: bytes(1), nonce: bytes(2), ciphertext: bytes(3) };
    await store.putPrevLockedIdentity(locked);
    expect(await store.getPrevLockedIdentity()).toEqual(locked);
    await store.deletePrevLockedIdentity();
    await expect(store.getPrevLockedIdentity()).rejects.toBeInstanceOf(VaultNotFound);
  });
});
