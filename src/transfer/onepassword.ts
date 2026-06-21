import { zipSync, unzipSync } from 'fflate';
import { utf8, fromUtf8 } from '../crypto/b64';
import type { Content, Field } from '../items/types';
import type { Codec } from './types';
import {
  customFieldsOf,
  errMessage,
  field,
  joinExpiration,
  noteOf,
  splitExpiration,
  titleOf,
} from './mapping';

// 1Password .1pux export, a port of internal/transfer/onepassword.go. A .1pux is
// a ZIP containing export.attributes and export.data; export.data nests
// accounts → vaults → items. Item type is a categoryUuid (001 login, 002 card,
// 003 secure note, 004 identity, 005 password). Login credentials live in
// details.loginFields; notes in details.notesPlain; the standalone password in
// details.password; everything else lives in details.sections, where each field's
// value is a single-key object keyed by its type ("string", "concealed",
// "monthYear", "totp", "url", …).

const OP_LOGIN = '001';
const OP_CARD = '002';
const OP_NOTE = '003';
const OP_IDENTITY = '004';
const OP_PASSWORD = '005';

const OP_CARD_IDS: { id: string; label: string }[] = [
  { id: 'cardholder', label: 'Cardholder' },
  { id: 'ccnum', label: 'Number' },
  { id: 'cvv', label: 'CVV' },
  { id: 'expiry', label: 'Expiration' },
  { id: 'pin', label: 'PIN' },
];
const OP_IDENTITY_IDS: { id: string; label: string }[] = [
  { id: 'firstname', label: 'First Name' },
  { id: 'lastname', label: 'Last Name' },
  { id: 'email', label: 'Email' },
  { id: 'phone', label: 'Phone' },
  { id: 'address', label: 'Address' },
  { id: 'company', label: 'Company' },
  { id: 'jobtitle', label: 'Job Title' },
];

interface OpUrl {
  label: string;
  url: string;
}
interface OpOverview {
  title: string;
  url?: string;
  urls?: OpUrl[];
  tags?: string[];
}
interface OpLoginField {
  value: string;
  name: string;
  designation: string;
  fieldType: string;
}
interface OpField {
  title: string;
  id: string;
  value: Record<string, unknown>;
}
interface OpSection {
  title: string;
  name: string;
  fields: OpField[];
}
interface OpDetails {
  loginFields?: OpLoginField[];
  notesPlain?: string;
  password?: string;
  sections?: OpSection[];
}
interface OpItem {
  uuid: string;
  createdAt: number;
  updatedAt: number;
  state: string;
  categoryUuid: string;
  overview: OpOverview;
  details: OpDetails;
}
interface OpVault {
  attrs: Record<string, unknown>;
  items: OpItem[];
}
interface OpAccount {
  attrs: Record<string, unknown>;
  vaults: OpVault[];
}
interface OpData {
  accounts: OpAccount[];
}

export const onePasswordCodec: Codec = {
  id: 'onepassword',
  name: '1Password (.1pux)',
  extension: '.1pux',

  marshal(contents) {
    const now = Math.floor(Date.now() / 1000);
    const vault: OpVault = {
      attrs: { uuid: 'cowbird', name: 'cowbird', type: 'P', desc: '', avatar: '' },
      items: contents.map((c, i) => opItemFrom(c, i, now)),
    };
    const data: OpData = {
      accounts: [
        {
          attrs: { accountName: 'cowbird', name: 'cowbird', uuid: 'cowbird', email: '', avatar: '', domain: '' },
          vaults: [vault],
        },
      ],
    };
    const files = {
      'export.data': utf8(JSON.stringify(data, null, 2)),
      'export.attributes': utf8(
        JSON.stringify({ version: 3, description: '1Password Unencrypted Export', createdAt: now }),
      ),
    };
    return Promise.resolve(zipSync(files));
  },

  async unmarshal(data) {
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(data);
    } catch (e) {
      throw new Error(`not a .1pux file (cannot open ZIP): ${errMessage(e)}`);
    }
    const raw = files['export.data'];
    if (!raw) throw new Error('not a .1pux file (no export.data)');
    let d: OpData;
    try {
      d = JSON.parse(fromUtf8(raw)) as OpData;
    } catch (e) {
      throw new Error(`parsing export.data: ${errMessage(e)}`);
    }
    const contents: Content[] = [];
    let skipped = 0;
    for (const acc of d.accounts ?? []) {
      for (const v of acc.vaults ?? []) {
        for (const it of v.items ?? []) {
          if (it.state === 'archived') {
            skipped++;
            continue;
          }
          contents.push(opItemTo(it));
        }
      }
    }
    return Promise.resolve({ contents, skipped });
  },
};

// --- cowbird → 1Password -----------------------------------------------------

function opItemFrom(c: Content, idx: number, now: number): OpItem {
  const it: OpItem = {
    uuid: `cowbird-${idx}`,
    state: 'active',
    createdAt: now,
    updatedAt: now,
    categoryUuid: OP_NOTE,
    overview: { title: titleOf(c) },
    details: { notesPlain: noteOf(c) },
  };
  const custom = opSectionFrom(customFieldsOf(c));

  switch (c.kind) {
    case 'login': {
      it.categoryUuid = OP_LOGIN;
      it.details.loginFields = [
        { value: c.data.username ?? '', name: 'username', designation: 'username', fieldType: 'T' },
        { value: c.data.password ?? '', name: 'password', designation: 'password', fieldType: 'P' },
      ];
      if (c.data.totp) {
        custom.fields.push({ title: 'one-time password', id: 'totp', value: { totp: c.data.totp } });
      }
      const urls = c.data.urls ?? [];
      if (urls.length) {
        it.overview.urls = urls.map((u) => ({ label: 'website', url: u }));
        it.overview.url = urls[0];
      }
      break;
    }
    case 'password':
      it.categoryUuid = OP_PASSWORD;
      it.details.password = c.data.password ?? '';
      break;
    case 'card':
      it.categoryUuid = OP_CARD;
      it.details.sections = [
        opStandardSection(
          OP_CARD_IDS,
          {
            cardholder: c.data.cardholder ?? '',
            ccnum: c.data.number ?? '',
            cvv: c.data.cvv ?? '',
            expiry: opExpFrom(c.data.expiration_date ?? ''),
            pin: c.data.pin ?? '',
          },
          { ccnum: 'creditCardNumber', cvv: 'concealed', expiry: 'monthYear', pin: 'concealed' },
        ),
      ];
      break;
    case 'identity':
      it.categoryUuid = OP_IDENTITY;
      it.details.sections = [
        opStandardSection(
          OP_IDENTITY_IDS,
          {
            firstname: c.data.first_name ?? '',
            lastname: c.data.last_name ?? '',
            email: c.data.email ?? '',
            phone: c.data.phone ?? '',
            address: c.data.address ?? '',
            company: c.data.company ?? '',
            jobtitle: c.data.job_title ?? '',
          },
          {},
        ),
      ];
      break;
    default: // note, custom
      it.categoryUuid = OP_NOTE;
      break;
  }

  if (custom.fields.length) {
    it.details.sections = [...(it.details.sections ?? []), custom];
  }
  return it;
}

function opStandardSection(
  ids: { id: string; label: string }[],
  values: Record<string, string>,
  valueType: Record<string, string>,
): OpSection {
  const sec: OpSection = { title: '', name: '', fields: [] };
  for (const f of ids) {
    const val = values[f.id] ?? '';
    if (val === '') continue;
    const key = valueType[f.id] || 'string';
    sec.fields.push({ title: f.label, id: f.id, value: opValue(key, val) });
  }
  return sec;
}

function opValue(key: string, val: string): Record<string, unknown> {
  if (key === 'monthYear' && /^\d+$/.test(val)) {
    return { monthYear: Number.parseInt(val, 10) };
  }
  return { [key]: val };
}

function opSectionFrom(fields: Field[]): OpSection {
  const sec: OpSection = { title: 'Custom', name: 'cowbird-custom', fields: [] };
  for (const f of fields) {
    let key = 'string';
    if (f.type === 'hidden') key = 'concealed';
    else if (f.type === 'totp') key = 'totp';
    else if (f.type === 'url') key = 'url';
    sec.fields.push({ title: f.label, id: f.label, value: { [key]: f.value } });
  }
  return sec;
}

// opExpFrom converts cowbird "MM/YY" to 1Password's monthYear "YYYYMM" string.
function opExpFrom(s: string): string {
  let { month } = splitExpiration(s);
  const { year } = splitExpiration(s);
  if (month === '' || year === '') return '';
  if (month.length === 1) month = '0' + month;
  return year + month;
}

// --- 1Password → cowbird -----------------------------------------------------

function opItemTo(it: OpItem): Content {
  const title = it.overview?.title ?? '';
  const note = it.details?.notesPlain ?? '';
  const sections = it.details?.sections ?? [];

  switch (it.categoryUuid) {
    case OP_LOGIN: {
      let username = '';
      let password = '';
      for (const lf of it.details?.loginFields ?? []) {
        if (lf.designation === 'username') username = lf.value;
        else if (lf.designation === 'password') password = lf.value;
      }
      let urls = (it.overview?.urls ?? []).map((u) => u.url).filter((u) => u !== '');
      if (urls.length === 0 && it.overview?.url) urls = [it.overview.url];
      const { totp, custom } = opExtractTotp(sections);
      return {
        kind: 'login',
        data: {
          title,
          username,
          password,
          ...(urls.length ? { urls } : {}),
          ...(totp ? { totp } : {}),
          ...(note ? { note } : {}),
          ...(custom.length ? { custom_fields: custom } : {}),
        },
      };
    }
    case OP_PASSWORD: {
      const custom = opAllCustom(sections);
      return {
        kind: 'password',
        data: {
          title,
          password: it.details?.password ?? '',
          ...(note ? { note } : {}),
          ...(custom.length ? { custom_fields: custom } : {}),
        },
      };
    }
    case OP_CARD: {
      const { known, custom } = opSplitKnown(sections, knownIds(OP_CARD_IDS));
      return {
        kind: 'card',
        data: {
          title,
          cardholder: known.cardholder ?? '',
          number: known.ccnum ?? '',
          expiration_date: opExpTo(known.expiry ?? ''),
          ...(known.cvv ? { cvv: known.cvv } : {}),
          ...(known.pin ? { pin: known.pin } : {}),
          ...(note ? { note } : {}),
          ...(custom.length ? { custom_fields: custom } : {}),
        },
      };
    }
    case OP_IDENTITY: {
      const { known, custom } = opSplitKnown(sections, knownIds(OP_IDENTITY_IDS));
      return {
        kind: 'identity',
        data: {
          title,
          ...(known.firstname ? { first_name: known.firstname } : {}),
          ...(known.lastname ? { last_name: known.lastname } : {}),
          ...(known.email ? { email: known.email } : {}),
          ...(known.phone ? { phone: known.phone } : {}),
          ...(known.address ? { address: known.address } : {}),
          ...(known.company ? { company: known.company } : {}),
          ...(known.jobtitle ? { job_title: known.jobtitle } : {}),
          ...(note ? { note } : {}),
          ...(custom.length ? { custom_fields: custom } : {}),
        },
      };
    }
    default:
      return {
        kind: 'note',
        data: {
          title,
          body: note,
          ...(opAllCustom(sections).length ? { custom_fields: opAllCustom(sections) } : {}),
        },
      };
  }
}

function knownIds(ids: { id: string; label: string }[]): Set<string> {
  return new Set(ids.map((f) => f.id));
}

function opSplitKnown(
  sections: OpSection[],
  known: Set<string>,
): { known: Record<string, string>; custom: Field[] } {
  const values: Record<string, string> = {};
  const custom: Field[] = [];
  for (const sec of sections) {
    for (const f of sec.fields ?? []) {
      if (known.has(f.id)) {
        values[f.id] = opValueString(f.value);
        continue;
      }
      custom.push(opFieldTo(f));
    }
  }
  return { known: values, custom };
}

function opExtractTotp(sections: OpSection[]): { totp: string; custom: Field[] } {
  let totp = '';
  const custom: Field[] = [];
  for (const sec of sections) {
    for (const f of sec.fields ?? []) {
      if ('totp' in f.value && totp === '') {
        totp = opValueString(f.value);
        continue;
      }
      custom.push(opFieldTo(f));
    }
  }
  return { totp, custom };
}

function opAllCustom(sections: OpSection[]): Field[] {
  const custom: Field[] = [];
  for (const sec of sections) for (const f of sec.fields ?? []) custom.push(opFieldTo(f));
  return custom;
}

function opFieldTo(f: OpField): Field {
  let t: Field['type'] = 'text';
  if ('concealed' in f.value) t = 'hidden';
  else if ('totp' in f.value) t = 'totp';
  else if ('url' in f.value) t = 'url';
  return field(f.title || f.id, opValueString(f.value), t);
}

// opValueString extracts the scalar value from a 1Password value object,
// regardless of its type key (string/concealed/url/totp/monthYear/…).
function opValueString(m: Record<string, unknown>): string {
  const keys = Object.keys(m);
  if (keys.length === 0) return '';
  for (const key of ['string', 'concealed', 'url', 'totp', 'creditCardNumber', 'email', 'phone']) {
    if (key in m) return String(m[key]);
  }
  for (const v of Object.values(m)) {
    if (typeof v === 'number') return String(Math.trunc(v));
    return String(v);
  }
  return '';
}

// opExpTo converts a 1Password monthYear "YYYYMM" to cowbird "MM/YY".
function opExpTo(s: string): string {
  if (s.length === 6) return joinExpiration(s.slice(4), s.slice(0, 4));
  return s;
}
