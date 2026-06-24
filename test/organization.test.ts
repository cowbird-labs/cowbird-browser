import { beforeAll, describe, expect, it } from 'vitest';
import { initCrypto, utf8 } from '../src/crypto/index';
import { newIdentity } from '../src/crypto/identity';
import { sealToSelf, openFromSelf } from '../src/crypto/self';
import { MemoryKv } from '../src/vault/memory';
import { VaultStore } from '../src/vault/store';
import { loadOrganization, saveOrganization } from '../src/core/organization';
import type { App } from '../src/core/app';
import {
  Organization,
  newOrganization,
  parseOrganization,
  SCHEMA_VERSION,
} from '../src/organization/index';

beforeAll(async () => {
  await initCrypto();
});

// --- crypto: seal-to-self ----------------------------------------------------
// Mirrors internal/crypto/self_test.go.

describe('sealToSelf / openFromSelf', () => {
  it('round-trips plaintext without leaking it into the ciphertext', async () => {
    const id = newIdentity();
    const plaintext = utf8('{"labels":["work","email"],"favorite":true}');
    const sealed = await sealToSelf(id, plaintext);
    // The plaintext "work" must not appear verbatim in the ciphertext bytes.
    const hay = String.fromCharCode(...sealed.ciphertext);
    expect(hay.includes('work')).toBe(false);
    const got = await openFromSelf(id, sealed);
    expect(got).toEqual(plaintext);
  });

  it('round-trips empty plaintext', async () => {
    const id = newIdentity();
    const sealed = await sealToSelf(id, new Uint8Array(0));
    expect((await openFromSelf(id, sealed)).length).toBe(0);
  });

  it('fails to open with a different identity', async () => {
    const id = newIdentity();
    const other = newIdentity();
    const sealed = await sealToSelf(id, utf8('secret'));
    await expect(openFromSelf(other, sealed)).rejects.toThrow();
  });

  it('fails to open tampered ciphertext', async () => {
    const id = newIdentity();
    const sealed = await sealToSelf(id, utf8('secret'));
    sealed.ciphertext[0] = (sealed.ciphertext[0] ?? 0) ^ 0xff;
    await expect(openFromSelf(id, sealed)).rejects.toThrow();
  });
});

// --- organization model ------------------------------------------------------
// Mirrors internal/organization/organization_test.go.

describe('Organization', () => {
  it('toggles favorite and drops emptied meta', () => {
    const o = newOrganization();
    expect(o.isFavorite('a')).toBe(false);
    expect(o.toggleFavorite('a')).toBe(true);
    expect(o.isFavorite('a')).toBe(true);
    expect(o.toggleFavorite('a')).toBe(false);
    expect(o.items.has('a')).toBe(false);
  });

  it('assign dedupes and requires a defined label', () => {
    const o = newOrganization();
    o.assignLabel('item', 'ghost');
    expect(o.labelsOf('item')).toHaveLength(0);

    const work = o.addLabel('work', '');
    o.assignLabel('item', work.id);
    o.assignLabel('item', work.id);
    expect(o.labelsOf('item')).toEqual([work.id]);

    o.unassignLabel('item', work.id);
    expect(o.labelsOf('item')).toHaveLength(0);
    expect(o.items.has('item')).toBe(false);
  });

  it('deleteLabel strips the id from every item', () => {
    const o = newOrganization();
    const work = o.addLabel('work', '#fff');
    const email = o.addLabel('email', '');
    o.assignLabel('a', work.id);
    o.assignLabel('a', email.id);
    o.assignLabel('b', work.id);

    o.deleteLabel(work.id);

    expect(o.label(work.id)).toBeUndefined();
    expect(o.labelsOf('a')).toEqual([email.id]);
    expect(o.labelsOf('b')).toHaveLength(0);
    expect(o.items.has('b')).toBe(false);
  });

  it('renames and recolors', () => {
    const o = newOrganization();
    const l = o.addLabel('wrok', '');
    expect(o.renameLabel(l.id, 'work')).toBe(true);
    expect(o.recolorLabel(l.id, '#123456')).toBe(true);
    const got = o.label(l.id)!;
    expect(got.name).toBe('work');
    expect(got.color).toBe('#123456');
    expect(o.renameLabel('missing', 'x')).toBe(false);
  });

  it('forgets and prunes', () => {
    const o = newOrganization();
    const work = o.addLabel('work', '');
    o.setFavorite('keep', true);
    o.assignLabel('keep', work.id);
    o.setFavorite('gone', true);

    o.forget('gone');
    expect(o.items.has('gone')).toBe(false);

    o.setFavorite('stale', true);
    expect(o.prune(new Set(['keep']))).toBe(true);
    expect(o.items.has('stale')).toBe(false);
    expect(o.isFavorite('keep')).toBe(true);
    expect(o.prune(new Set(['keep']))).toBe(false);
  });

  it('round-trips through JSON and decodes empty/absent input', () => {
    const empty = parseOrganization(null);
    expect(empty.version).toBe(SCHEMA_VERSION);
    expect(empty.items.size).toBe(0);

    const work = empty.addLabel('work', '#abc');
    empty.setFavorite('a', true);
    empty.assignLabel('a', work.id);

    const bytes = utf8(JSON.stringify(empty.json()));
    const back = parseOrganization(bytes);
    expect(back.isFavorite('a')).toBe(true);
    expect(back.labelsOf('a')).toEqual([work.id]);
    const l = back.label(work.id)!;
    expect(l.name).toBe('work');
    expect(l.color).toBe('#abc');
  });

  it('requires a non-empty label name', () => {
    const o = newOrganization();
    expect(() => o.addLabel('', '')).toThrow();
  });

  it('persists a label recolor through the full encrypt/Vault/decrypt path', async () => {
    const store = new VaultStore(new MemoryKv(), 'entity-A');
    const app = { session: { store }, identity: newIdentity() } as unknown as App;

    const org = newOrganization();
    const work = org.addLabel('work', '#111111');
    org.setFavorite('item1', true);
    org.assignLabel('item1', work.id);
    await saveOrganization(app, org);

    const loaded = await loadOrganization(app);
    expect(loaded.label(work.id)?.color).toBe('#111111');
    loaded.recolorLabel(work.id, '#abcdef');
    await saveOrganization(app, loaded);

    const reloaded = await loadOrganization(app);
    expect(reloaded.label(work.id)?.color).toBe('#abcdef');
    expect(reloaded.isFavorite('item1')).toBe(true);
  });

  it('omits empty collections from JSON (matches Go omitempty)', () => {
    const o = new Organization();
    const j = o.json();
    expect(j).toEqual({ version: SCHEMA_VERSION });
  });
});
