import { utf8, fromUtf8 } from '../crypto/b64';
import type { Content, Field } from '../items/types';
import type { Codec, DecodeResult } from './types';
import {
  customFieldsOf,
  errMessage,
  field,
  joinExpiration,
  noteOf,
  splitExpiration,
  titleOf,
} from './mapping';
import { parseCsv } from './csv';

// Proton Pass export (JSON or CSV), a port of internal/transfer/proton.go. A JSON
// export holds one or more vaults keyed by an opaque id; each item carries a typed
// content block plus an extraFields array. We read every vault and write a single
// "cowbird" vault. login, note, and creditCard map to native cowbird types; other
// Proton types fall back to a note carrying their fields.

interface ProtonExtraData {
  content?: string;
  totpUri?: string;
}
interface ProtonExtra {
  fieldName: string;
  type: string;
  data: ProtonExtraData;
}
interface ProtonMeta {
  name: string;
  note: string;
}
interface ProtonData {
  metadata: ProtonMeta;
  extraFields: ProtonExtra[];
  type: string;
  content: unknown;
}
interface ProtonItem {
  data: ProtonData;
  state: number;
  aliasEmail: string | null;
  contentFormatVersion: number;
  createTime: number;
  modifyTime: number;
  pinned: boolean;
}
interface ProtonVault {
  name: string;
  description?: string;
  items: ProtonItem[];
}
interface ProtonFile {
  version: string;
  encrypted: boolean;
  userId: string;
  vaults: Record<string, ProtonVault>;
}
interface ProtonLoginContent {
  itemEmail?: string;
  itemUsername?: string;
  username?: string; // legacy (contentFormatVersion < 6)
  password?: string;
  urls?: string[];
  totpUri?: string;
}
interface ProtonCardContent {
  cardholderName?: string;
  number?: string;
  verificationNumber?: string;
  expirationDate?: string;
  pin?: string;
}

export const protonCodec: Codec = {
  id: 'proton',
  name: 'Proton Pass (JSON or CSV)',
  extension: '.json',

  marshal(contents) {
    const vault: ProtonVault = { name: 'cowbird', items: contents.map(protonItemFrom) };
    const file: ProtonFile = {
      version: '1.0.0',
      encrypted: false,
      userId: '',
      vaults: { cowbird: vault },
    };
    return Promise.resolve(utf8(JSON.stringify(file, null, 2)));
  },

  async unmarshal(data) {
    // Proton exports either JSON or CSV; dispatch on the first non-space byte.
    const text = fromUtf8(data);
    const trimmed = text.replace(/^[\s﻿]+/, '');
    if (trimmed === '' || trimmed[0] !== '{') return Promise.resolve(protonUnmarshalCsv(text));

    let file: ProtonFile;
    try {
      file = JSON.parse(text) as ProtonFile;
    } catch (e) {
      throw new Error(`parsing Proton Pass export: ${errMessage(e)}`);
    }
    if (!file || !file.vaults || typeof file.vaults !== 'object') {
      throw new Error('not a Proton Pass export (no vaults)');
    }
    const contents: Content[] = [];
    let skipped = 0;
    for (const vault of Object.values(file.vaults)) {
      for (const it of vault.items ?? []) {
        const c = protonItemTo(it);
        if (!c) {
          skipped++;
          continue;
        }
        contents.push(c);
      }
    }
    return Promise.resolve({ contents, skipped });
  },
};

// protonUnmarshalCsv parses a Proton Pass CSV export by (lower-cased) header name.
function protonUnmarshalCsv(text: string): DecodeResult {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error('reading Proton Pass CSV header: empty file');
  const header = rows[0]!;
  const col = new Map<string, number>();
  header.forEach((h, i) => col.set(h.replace(/﻿/g, '').trim().toLowerCase(), i));
  if (!col.has('name') && !col.has('title')) {
    throw new Error('not a Proton Pass CSV (missing name/title column)');
  }
  const get = (rec: string[], ...keys: string[]): string => {
    for (const k of keys) {
      const i = col.get(k);
      if (i !== undefined && i < rec.length && rec[i] !== '') return rec[i]!;
    }
    return '';
  };

  const contents: Content[] = [];
  for (const rec of rows.slice(1)) {
    const name = get(rec, 'name', 'title');
    const note = get(rec, 'note', 'notes');
    if (get(rec, 'type').toLowerCase() === 'note') {
      contents.push({ kind: 'note', data: { title: name, body: note } });
      continue;
    }
    let username = get(rec, 'username');
    const email = get(rec, 'email');
    const cf: Field[] = [];
    if (username === '') {
      username = email;
    } else if (email !== '') {
      cf.push(field('Email', email, 'text'));
    }
    const url = get(rec, 'url');
    const totp = get(rec, 'totp');
    contents.push({
      kind: 'login',
      data: {
        title: name,
        username,
        password: get(rec, 'password'),
        ...(url ? { urls: [url] } : {}),
        ...(totp ? { totp } : {}),
        ...(note ? { note } : {}),
        ...(cf.length ? { custom_fields: cf } : {}),
      },
    });
  }
  return { contents, skipped: 0 };
}

// --- cowbird → Proton --------------------------------------------------------

function protonItemFrom(c: Content): ProtonItem {
  const data: ProtonData = {
    metadata: { name: titleOf(c), note: noteOf(c) },
    extraFields: protonExtraFrom(customFieldsOf(c)),
    type: 'note',
    content: {},
  };

  switch (c.kind) {
    case 'login':
      data.type = 'login';
      data.content = {
        itemEmail: '',
        itemUsername: c.data.username ?? '',
        password: c.data.password ?? '',
        urls: c.data.urls ?? [],
        totpUri: c.data.totp ?? '',
        passkeys: [],
      } satisfies ProtonLoginContent & { passkeys: unknown[] };
      break;
    case 'password':
      data.type = 'login';
      data.content = {
        itemEmail: '',
        itemUsername: '',
        password: c.data.password ?? '',
        urls: [],
        totpUri: '',
        passkeys: [],
      };
      break;
    case 'card':
      data.type = 'creditCard';
      data.content = {
        cardholderName: c.data.cardholder ?? '',
        number: c.data.number ?? '',
        verificationNumber: c.data.cvv ?? '',
        expirationDate: protonExpFrom(c.data.expiration_date ?? ''),
        pin: c.data.pin ?? '',
      } satisfies ProtonCardContent;
      break;
    case 'identity':
      // Proton's identity schema is large and version-sensitive; emit a note
      // carrying every field as an extra field so the export stays importable.
      data.type = 'note';
      data.extraFields = [...protonIdentityFields(c), ...data.extraFields];
      data.content = {};
      break;
    default: // note, custom
      data.type = 'note';
      data.content = {};
      break;
  }

  return {
    data,
    state: 1,
    aliasEmail: null,
    contentFormatVersion: 6,
    createTime: 0,
    modifyTime: 0,
    pinned: false,
  };
}

function protonExtraFrom(fields: Field[]): ProtonExtra[] {
  return fields.map((f) => {
    if (f.type === 'hidden') return { fieldName: f.label, type: 'hidden', data: { content: f.value } };
    if (f.type === 'totp') return { fieldName: f.label, type: 'totp', data: { totpUri: f.value } };
    return { fieldName: f.label, type: 'text', data: { content: f.value } };
  });
}

function protonIdentityFields(c: Content & { kind: 'identity' }): ProtonExtra[] {
  const pairs: [string, string | undefined][] = [
    ['First Name', c.data.first_name],
    ['Last Name', c.data.last_name],
    ['Email', c.data.email],
    ['Phone', c.data.phone],
    ['Address', c.data.address],
    ['Company', c.data.company],
    ['Job Title', c.data.job_title],
  ];
  const out: ProtonExtra[] = [];
  for (const [label, value] of pairs) {
    if (value) out.push({ fieldName: label, type: 'text', data: { content: value } });
  }
  return out;
}

// --- Proton → cowbird --------------------------------------------------------

function protonItemTo(it: ProtonItem): Content | null {
  const name = it.data?.metadata?.name ?? '';
  const note = it.data?.metadata?.note ?? '';
  const cf = protonExtraTo(it.data?.extraFields ?? []);

  switch (it.data?.type) {
    case 'login': {
      const lg = (it.data.content ?? {}) as ProtonLoginContent;
      const username = lg.itemUsername || lg.username || lg.itemEmail || '';
      const urls = trimEmpty(lg.urls ?? []);
      return {
        kind: 'login',
        data: {
          title: name,
          username,
          password: lg.password ?? '',
          ...(urls.length ? { urls } : {}),
          ...(lg.totpUri ? { totp: lg.totpUri } : {}),
          ...(note ? { note } : {}),
          ...(cf.length ? { custom_fields: cf } : {}),
        },
      };
    }
    case 'creditCard': {
      const cd = (it.data.content ?? {}) as ProtonCardContent;
      return {
        kind: 'card',
        data: {
          title: name,
          cardholder: cd.cardholderName ?? '',
          number: cd.number ?? '',
          expiration_date: protonExpTo(cd.expirationDate ?? ''),
          ...(cd.verificationNumber ? { cvv: cd.verificationNumber } : {}),
          ...(cd.pin ? { pin: cd.pin } : {}),
          ...(note ? { note } : {}),
          ...(cf.length ? { custom_fields: cf } : {}),
        },
      };
    }
    default: {
      // note, identity, alias, etc.: a note carrying the text and any extra
      // fields. Alias email, if present, is preserved as a field.
      const extra = [...cf];
      if (it.aliasEmail) extra.push(field('Alias Email', it.aliasEmail, 'text'));
      return {
        kind: 'note',
        data: {
          title: name,
          body: note,
          ...(extra.length ? { custom_fields: extra } : {}),
        },
      };
    }
  }
}

function protonExtraTo(extras: ProtonExtra[]): Field[] {
  return extras.map((e) => {
    if (e.type === 'hidden') return field(e.fieldName, e.data.content ?? '', 'hidden');
    if (e.type === 'totp') return field(e.fieldName, e.data.totpUri ?? '', 'totp');
    return field(e.fieldName, e.data.content ?? '', 'text');
  });
}

// protonExpFrom converts cowbird "MM/YY" to Proton's "YYYY-MM".
function protonExpFrom(s: string): string {
  const parsed = splitExpiration(s);
  let month = parsed.month;
  const year = parsed.year;
  if (month === '' || year === '') return '';
  if (month.length === 1) month = '0' + month;
  return `${year}-${month}`;
}

// protonExpTo converts Proton's "YYYY-MM" (lenient: also "MMYYYY" and "MM/YY")
// to cowbird "MM/YY".
function protonExpTo(s: string): string {
  s = s.trim();
  if (s.includes('-')) {
    const idx = s.indexOf('-');
    return joinExpiration(s.slice(idx + 1), s.slice(0, idx));
  }
  if (s.includes('/')) return s;
  if (s.length === 6) return joinExpiration(s.slice(0, 2), s.slice(2));
  return s;
}

function trimEmpty(s: string[]): string[] {
  return s.filter((v) => v.trim() !== '');
}
