import { beforeAll, describe, expect, it } from 'vitest';
import {
  initCrypto,
  sodium,
  seal,
  open,
  deriveUnlockKey,
  generateSalt,
  wrapKey,
  unwrapKey,
  newItemKey,
  newIdentity,
  lockIdentity,
  unlockIdentity,
  ensureSigningKey,
  exportKey,
  importKey,
  utf8,
  b64encode,
  b64decode,
} from '../src/crypto/index';

beforeAll(async () => {
  await initCrypto();
});

describe('AEAD seal/open', () => {
  it('round-trips with associated data', () => {
    const key = sodium.randombytes_buf(32);
    const plaintext = utf8('the rain in spain');
    const aad = utf8('owner\x00login');
    const { nonce, ciphertext } = seal(key, plaintext, aad);
    expect(nonce.length).toBe(24);
    const out = open(key, nonce, ciphertext, aad);
    expect(sodium.to_string(out)).toBe('the rain in spain');
  });

  it('fails on wrong aad', () => {
    const key = sodium.randombytes_buf(32);
    const { nonce, ciphertext } = seal(key, utf8('secret'), utf8('aad-a'));
    expect(() => open(key, nonce, ciphertext, utf8('aad-b'))).toThrow('decryption failed');
  });

  it('fails on wrong key', () => {
    const { nonce, ciphertext } = seal(sodium.randombytes_buf(32), utf8('secret'), null);
    expect(() => open(sodium.randombytes_buf(32), nonce, ciphertext, null)).toThrow(
      'decryption failed',
    );
  });
});

describe('base64', () => {
  it('uses standard padded encoding (Go []byte form)', () => {
    // "hello" -> standard base64 with padding
    expect(b64encode(utf8('hello'))).toBe('aGVsbG8=');
    expect(sodium.to_string(b64decode('aGVsbG8='))).toBe('hello');
  });
});

describe('KDF', () => {
  it('is deterministic for a fixed password and salt', async () => {
    const salt = generateSalt();
    const a = await deriveUnlockKey(utf8('hunter2'), salt);
    const b = await deriveUnlockKey(utf8('hunter2'), salt);
    expect(a.length).toBe(32);
    expect(b64encode(a)).toBe(b64encode(b));
  });

  it('differs for a different password', async () => {
    const salt = generateSalt();
    const a = await deriveUnlockKey(utf8('hunter2'), salt);
    const b = await deriveUnlockKey(utf8('hunter3'), salt);
    expect(b64encode(a)).not.toBe(b64encode(b));
  });
});

describe('key wrapping (X25519)', () => {
  it('wraps and unwraps an item key between identities', async () => {
    const recipient = newIdentity();
    const itemKey = newItemKey();
    const w = await wrapKey(recipient.encryptionPub, itemKey);
    const recovered = await unwrapKey(recipient.encryptionPriv, w.ephemeralPub, w.nonce, w.wrapped);
    expect(b64encode(recovered)).toBe(b64encode(itemKey));
  });

  it('cannot be unwrapped by the wrong recipient', async () => {
    const recipient = newIdentity();
    const stranger = newIdentity();
    const w = await wrapKey(recipient.encryptionPub, newItemKey());
    await expect(
      unwrapKey(stranger.encryptionPriv, w.ephemeralPub, w.nonce, w.wrapped),
    ).rejects.toThrow('decryption failed');
  });
});

describe('identity lock/unlock', () => {
  it('round-trips an identity through a password', async () => {
    const id = newIdentity();
    const locked = await lockIdentity(id, utf8('correct horse'));
    const unlocked = await unlockIdentity(locked, utf8('correct horse'));
    expect(b64encode(unlocked.encryptionPriv)).toBe(b64encode(id.encryptionPriv));
    expect(b64encode(unlocked.encryptionPub)).toBe(b64encode(id.encryptionPub));
    expect(b64encode(unlocked.signingPriv)).toBe(b64encode(id.signingPriv));
    expect(unlocked.fingerprint).toBe(id.fingerprint);
  });

  it('rejects a wrong password generically', async () => {
    const locked = await lockIdentity(newIdentity(), utf8('right'));
    await expect(unlockIdentity(locked, utf8('wrong'))).rejects.toThrow(
      'incorrect password or corrupted key material',
    );
  });

  it('ensureSigningKey is a no-op when a key already exists', () => {
    const id = newIdentity();
    expect(ensureSigningKey(id)).toBe(false);
  });

  it('ensureSigningKey mints a key for a legacy identity', () => {
    const id = newIdentity();
    id.signingPriv = new Uint8Array(0);
    id.signingPub = new Uint8Array(0);
    expect(ensureSigningKey(id)).toBe(true);
    expect(id.signingPriv.length).toBe(64);
  });
});

describe('key export/import', () => {
  it('round-trips an identity through a recovery file', async () => {
    const id = newIdentity();
    const file = await exportKey(id, utf8('export passphrase'));
    const restored = await importKey(file, utf8('export passphrase'));
    expect(b64encode(restored.encryptionPriv)).toBe(b64encode(id.encryptionPriv));
    expect(restored.fingerprint).toBe(id.fingerprint);
  });

  it('fails to import under the wrong passphrase', async () => {
    const file = await exportKey(newIdentity(), utf8('right'));
    await expect(importKey(file, utf8('wrong'))).rejects.toThrow();
  });
});
