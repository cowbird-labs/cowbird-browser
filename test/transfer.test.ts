import { describe, expect, it } from 'vitest';
import type { Content, Field, Login } from '../src/items/types';
import type { App } from '../src/core/app';
import { encodeExport, decodeExport } from '../src/items/transfer';
import { cowbirdCodec } from '../src/transfer/cowbird';
import { bitwardenCodec } from '../src/transfer/bitwarden';
import { lastPassCodec } from '../src/transfer/lastpass';
import { protonCodec } from '../src/transfer/proton';
import { onePasswordCodec } from '../src/transfer/onepassword';
import type { Codec } from '../src/transfer/types';
import { exportItems, importItems, removeDuplicateItems } from '../src/core/transfer';

const login: Content = {
  kind: 'login',
  data: {
    title: 'GitHub',
    username: 'breaker1',
    password: 's3cr3t',
    urls: ['https://github.com'],
    totp: 'OTPSEED',
    note: 'hello',
    custom_fields: [{ type: 'hidden', label: 'recovery', value: 'xyz' }],
  },
};
const card: Content = {
  kind: 'card',
  data: {
    title: 'Visa',
    cardholder: 'A B',
    number: '4111111111111111',
    expiration_date: '08/27',
    cvv: '123',
    pin: '4321',
    note: 'n',
  },
};
const note: Content = { kind: 'note', data: { title: 'Note', body: 'secret body' } };
const identity: Content = {
  kind: 'identity',
  data: {
    title: 'Me',
    first_name: 'A',
    last_name: 'B',
    email: 'a@b.com',
    phone: '555',
    address: '1 St',
    company: 'Co',
    job_title: 'Eng',
    note: 'n',
  },
};
const pw: Content = { kind: 'password', data: { title: 'pw', password: 'p@ss', note: 'n' } };

const all = [login, card, note, identity, pw];

function findLogin(contents: Content[], title: string): Login {
  const c = contents.find((x) => x.kind === 'login' && x.data.title === title);
  if (!c || c.kind !== 'login') throw new Error(`no login titled ${title}`);
  return c.data;
}
function customByLabel(fields: Field[] | undefined, label: string): Field | undefined {
  return (fields ?? []).find((f) => f.label === label);
}

async function roundTrip(codec: Codec, contents: Content[]): Promise<Content[]> {
  const { contents: out } = await codec.unmarshal(await codec.marshal(contents));
  return out;
}

describe('cowbird native export', () => {
  it('round-trips every item type losslessly', () => {
    const { contents, skipped } = decodeExport(encodeExport(all));
    expect(skipped).toBe(0);
    expect(contents).toEqual(all);
  });

  it('rejects a non-cowbird document', () => {
    expect(() => decodeExport(new TextEncoder().encode('{"format":"nope","version":1,"items":[]}'))).toThrow(
      /not a cowbird export/,
    );
  });

  it('rejects an unsupported version', () => {
    expect(() =>
      decodeExport(new TextEncoder().encode('{"format":"cowbird-export","version":999,"items":[]}')),
    ).toThrow(/unsupported export version/);
  });

  it('skips undecodable entries without aborting', () => {
    const doc = JSON.stringify({
      format: 'cowbird-export',
      version: 1,
      items: [{ type: 'login', data: { title: 'ok' } }, { type: 'bogus', data: {} }],
    });
    const { contents, skipped } = decodeExport(new TextEncoder().encode(doc));
    expect(contents).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  it('codec mirrors the native functions', async () => {
    expect(await roundTrip(cowbirdCodec, all)).toEqual(all);
  });
});

describe('Bitwarden codec', () => {
  it('round-trips a login with totp, urls, note and a hidden field', async () => {
    const out = await roundTrip(bitwardenCodec, [login]);
    const lg = findLogin(out, 'GitHub');
    expect(lg.username).toBe('breaker1');
    expect(lg.password).toBe('s3cr3t');
    expect(lg.urls).toEqual(['https://github.com']);
    expect(lg.totp).toBe('OTPSEED');
    expect(lg.note).toBe('hello');
    expect(customByLabel(lg.custom_fields, 'recovery')).toMatchObject({ type: 'hidden', value: 'xyz' });
  });

  it('round-trips a card (PIN carried as a custom field)', async () => {
    const out = await roundTrip(bitwardenCodec, [card]);
    const c = out[0];
    expect(c?.kind).toBe('card');
    if (c?.kind !== 'card') throw new Error('not a card');
    expect(c.data.number).toBe('4111111111111111');
    expect(c.data.cvv).toBe('123');
    expect(c.data.expiration_date).toBe('08/27');
    expect(customByLabel(c.data.custom_fields, 'PIN')?.value).toBe('4321');
  });

  it('round-trips a secure note and an identity', async () => {
    const out = await roundTrip(bitwardenCodec, [note, identity]);
    expect(out.find((x) => x.kind === 'note')?.data.title).toBe('Note');
    const id = out.find((x) => x.kind === 'identity');
    expect(id?.kind).toBe('identity');
    if (id?.kind === 'identity') expect(id.data.address).toContain('1 St');
  });

  it('rejects a file with no items array', async () => {
    await expect(bitwardenCodec.unmarshal(new TextEncoder().encode('{"foo":1}'))).rejects.toThrow(
      /not a Bitwarden export/,
    );
  });
});

describe('LastPass codec', () => {
  it('round-trips a login (custom fields flattened into the note)', async () => {
    const out = await roundTrip(lastPassCodec, [login]);
    const lg = findLogin(out, 'GitHub');
    expect(lg.username).toBe('breaker1');
    expect(lg.password).toBe('s3cr3t');
    expect(lg.urls).toEqual(['https://github.com']);
    expect(lg.totp).toBe('OTPSEED');
    expect(lg.note).toContain('hello');
    expect(lg.note).toContain('recovery: xyz');
  });

  it('round-trips a secure note', async () => {
    const out = await roundTrip(lastPassCodec, [note]);
    const n = out.find((x) => x.kind === 'note');
    expect(n?.data.title).toBe('Note');
    if (n?.kind === 'note') expect(n.data.body).toBe('secret body');
  });

  it('rejects a CSV that only has a name column (mis-routed file)', async () => {
    const csv = 'name,colour\nApple,red\n';
    await expect(lastPassCodec.unmarshal(new TextEncoder().encode(csv))).rejects.toThrow(
      /not a LastPass CSV/,
    );
  });

  it('skips ragged rows and reports the skipped count', async () => {
    const csv =
      'url,username,password,totp,extra,name,grouping,fav\n' +
      'https://acme.test,alice,pw123,,,Acme,,0\n' +
      'too,few,fields\n'; // wrong column count → malformed
    const { contents, skipped } = await lastPassCodec.unmarshal(new TextEncoder().encode(csv));
    expect(skipped).toBe(1);
    expect(contents).toHaveLength(1);
    expect(findLogin(contents, 'Acme').username).toBe('alice');
  });
});

describe('Proton codec', () => {
  it('round-trips login, card and note (JSON)', async () => {
    const out = await roundTrip(protonCodec, [login, card, note]);
    const lg = findLogin(out, 'GitHub');
    expect(lg.password).toBe('s3cr3t');
    expect(lg.totp).toBe('OTPSEED');
    expect(lg.urls).toEqual(['https://github.com']);
    const c = out.find((x) => x.kind === 'card');
    if (c?.kind === 'card') {
      expect(c.data.number).toBe('4111111111111111');
      expect(c.data.expiration_date).toBe('08/27');
      expect(c.data.cvv).toBe('123');
    }
    expect(out.find((x) => x.kind === 'note')?.data.title).toBe('Note');
  });

  it('parses a Proton CSV export', async () => {
    const csv =
      'type,name,url,email,username,password,note,totp\n' +
      'login,Acme,https://acme.test,,alice,pw123,a note,SEED\n' +
      'note,Memo,,,,,just text,\n';
    const { contents } = await protonCodec.unmarshal(new TextEncoder().encode(csv));
    const lg = findLogin(contents, 'Acme');
    expect(lg.username).toBe('alice');
    expect(lg.password).toBe('pw123');
    expect(lg.urls).toEqual(['https://acme.test']);
    expect(lg.totp).toBe('SEED');
    expect(contents.find((x) => x.kind === 'note')?.data.title).toBe('Memo');
  });
});

describe('1Password .1pux codec', () => {
  it('round-trips login (totp), card, identity, note and password through the ZIP', async () => {
    const out = await roundTrip(onePasswordCodec, all);
    const lg = findLogin(out, 'GitHub');
    expect(lg.password).toBe('s3cr3t');
    expect(lg.username).toBe('breaker1');
    expect(lg.totp).toBe('OTPSEED');
    expect(lg.urls).toEqual(['https://github.com']);

    const c = out.find((x) => x.kind === 'card');
    if (c?.kind === 'card') {
      expect(c.data.number).toBe('4111111111111111');
      expect(c.data.cvv).toBe('123');
      expect(c.data.expiration_date).toBe('08/27');
      expect(c.data.pin).toBe('4321');
    }
    const id = out.find((x) => x.kind === 'identity');
    if (id?.kind === 'identity') {
      expect(id.data.first_name).toBe('A');
      expect(id.data.job_title).toBe('Eng');
    }
    const p = out.find((x) => x.kind === 'password');
    if (p?.kind === 'password') expect(p.data.password).toBe('p@ss');
    expect(out.find((x) => x.kind === 'note')?.data.title).toBe('Note');
  });

  it('rejects a non-zip file', async () => {
    await expect(onePasswordCodec.unmarshal(new TextEncoder().encode('not a zip'))).rejects.toThrow(
      /not a \.1pux file/,
    );
  });
});

// --- core export/import/dedup against a fake service -------------------------

function makeApp(initial: Content[]) {
  const store = initial.map((data, i) => ({ id: `id${i}`, data }));
  const created: Content[] = [];
  const deleted: string[] = [];
  const service = {
    listItems: () => Promise.resolve(store.map((s) => ({ id: s.id }))),
    openOwnItem: (env: { id: string }) => {
      const found = store.find((s) => s.id === env.id);
      return found ? Promise.resolve(found.data) : Promise.reject(new Error('not found'));
    },
    createItem: (content: Content) => {
      created.push(content);
      return Promise.resolve({ id: `new${created.length}` });
    },
    deleteItem: (id: string) => {
      deleted.push(id);
      return Promise.resolve();
    },
  };
  return { app: { service } as unknown as App, created, deleted };
}

describe('core item transfer', () => {
  it('exports then imports through the cowbird codec', async () => {
    const src = makeApp(all);
    const bytes = await exportItems(src.app, cowbirdCodec);
    const dst = makeApp([]);
    const res = await importItems(dst.app, cowbirdCodec, bytes);
    expect(res).toEqual({ imported: all.length, skipped: 0 });
    expect(dst.created).toEqual(all);
  });

  it('removes duplicate items, keeping one (dry-run reports, then deletes)', async () => {
    const dup = makeApp([login, login, note]);
    expect(await removeDuplicateItems(dup.app, true)).toBe(1);
    expect(dup.deleted).toEqual([]); // dry run deletes nothing

    const dup2 = makeApp([login, login, note]);
    expect(await removeDuplicateItems(dup2.app, false)).toBe(1);
    expect(dup2.deleted).toEqual(['id1']);
  });
});
