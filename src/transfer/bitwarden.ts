import { utf8, fromUtf8 } from '../crypto/b64';
import type { Content, Field } from '../items/types';
import type { Codec } from './types';
import {
  appendIfValue,
  customFieldsOf,
  errMessage,
  field,
  joinExpiration,
  noteOf,
  splitExpiration,
  titleOf,
} from './mapping';

// Bitwarden JSON export, a port of internal/transfer/bitwarden.go. Item type
// codes: 1 login, 2 secureNote, 3 card, 4 identity. Custom field types: 0 text,
// 1 hidden.

const BW_LOGIN = 1;
const BW_SECURE_NOTE = 2;
const BW_CARD = 3;
const BW_IDENTITY = 4;

interface BwField {
  name: string;
  value: string;
  type: number;
}
interface BwUri {
  uri: string;
}
interface BwLogin {
  username?: string;
  password?: string;
  uris?: BwUri[];
  totp?: string;
}
interface BwCard {
  cardholderName?: string;
  brand?: string;
  number?: string;
  expMonth?: string;
  expYear?: string;
  code?: string;
}
interface BwIdentity {
  title?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  address1?: string;
  address2?: string;
  address3?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  company?: string;
  email?: string;
  phone?: string;
  ssn?: string;
  username?: string;
  passportNumber?: string;
  licenseNumber?: string;
}
interface BwItem {
  type: number;
  name: string;
  notes?: string;
  favorite: boolean;
  fields?: BwField[];
  login?: BwLogin;
  card?: BwCard;
  identity?: BwIdentity;
  secureNote?: { type: number };
}
interface BwFile {
  encrypted: boolean;
  folders: unknown[];
  items: BwItem[];
}

export const bitwardenCodec: Codec = {
  id: 'bitwarden',
  name: 'Bitwarden (JSON)',
  extension: '.json',

  marshal(contents) {
    const file: BwFile = { encrypted: false, folders: [], items: contents.map(bwItemFrom) };
    return Promise.resolve(utf8(JSON.stringify(file, null, 2)));
  },

  async unmarshal(data) {
    let file: BwFile;
    try {
      file = JSON.parse(fromUtf8(data)) as BwFile;
    } catch (e) {
      throw new Error(`parsing Bitwarden export: ${errMessage(e)}`);
    }
    if (!file || !Array.isArray(file.items)) {
      throw new Error('not a Bitwarden export (no items array)');
    }
    const contents: Content[] = [];
    let skipped = 0;
    for (const it of file.items) {
      const c = bwItemTo(it);
      if (!c) {
        skipped++;
        continue;
      }
      contents.push(c);
    }
    return Promise.resolve({ contents, skipped });
  },
};

// --- cowbird → Bitwarden -----------------------------------------------------

function bwItemFrom(c: Content): BwItem {
  const it: BwItem = { type: 0, name: titleOf(c), favorite: false };
  const note = noteOf(c);
  if (note) it.notes = note;
  let cf = customFieldsOf(c);

  switch (c.kind) {
    case 'login': {
      it.type = BW_LOGIN;
      const lg: BwLogin = {};
      if (c.data.username) lg.username = c.data.username;
      if (c.data.password) lg.password = c.data.password;
      if (c.data.totp) lg.totp = c.data.totp;
      const uris = (c.data.urls ?? []).map((u) => ({ uri: u }));
      if (uris.length) lg.uris = uris;
      it.login = lg;
      break;
    }
    case 'password': {
      // No Bitwarden standalone-password type; carry as a login.
      it.type = BW_LOGIN;
      const lg: BwLogin = {};
      if (c.data.password) lg.password = c.data.password;
      it.login = lg;
      break;
    }
    case 'card': {
      it.type = BW_CARD;
      const { month, year } = splitExpiration(c.data.expiration_date ?? '');
      const cd: BwCard = {};
      if (c.data.cardholder) cd.cardholderName = c.data.cardholder;
      if (c.data.number) cd.number = c.data.number;
      if (c.data.cvv) cd.code = c.data.cvv;
      if (month) cd.expMonth = month;
      if (year) cd.expYear = year;
      it.card = cd;
      cf = appendIfValue(cf, 'PIN', c.data.pin ?? '', 'hidden');
      break;
    }
    case 'identity': {
      it.type = BW_IDENTITY;
      const id: BwIdentity = {};
      if (c.data.first_name) id.firstName = c.data.first_name;
      if (c.data.last_name) id.lastName = c.data.last_name;
      if (c.data.email) id.email = c.data.email;
      if (c.data.phone) id.phone = c.data.phone;
      if (c.data.company) id.company = c.data.company;
      if (c.data.address) id.address1 = c.data.address;
      it.identity = id;
      cf = appendIfValue(cf, 'Job Title', c.data.job_title ?? '', 'text');
      break;
    }
    case 'note':
      it.type = BW_SECURE_NOTE;
      it.secureNote = { type: 0 };
      break;
    default: // Custom
      it.type = BW_SECURE_NOTE;
      it.secureNote = { type: 0 };
      break;
  }

  const fields = bwFieldsFrom(cf);
  if (fields) it.fields = fields;
  return it;
}

function bwFieldsFrom(fields: Field[]): BwField[] | undefined {
  if (fields.length === 0) return undefined;
  return fields.map((f) => ({ name: f.label, value: f.value, type: f.type === 'hidden' ? 1 : 0 }));
}

// --- Bitwarden → cowbird -----------------------------------------------------

function bwItemTo(it: BwItem): Content | null {
  const cf = bwFieldsTo(it.fields);
  switch (it.type) {
    case BW_LOGIN: {
      const lg = it.login ?? {};
      const urls = (lg.uris ?? []).map((u) => u.uri).filter((u) => u !== '');
      return {
        kind: 'login',
        data: {
          title: it.name,
          username: lg.username ?? '',
          password: lg.password ?? '',
          ...(urls.length ? { urls } : {}),
          ...(lg.totp ? { totp: lg.totp } : {}),
          ...(it.notes ? { note: it.notes } : {}),
          ...(cf.length ? { custom_fields: cf } : {}),
        },
      };
    }
    case BW_CARD: {
      const cd = it.card ?? {};
      return {
        kind: 'card',
        data: {
          title: it.name,
          cardholder: cd.cardholderName ?? '',
          number: cd.number ?? '',
          expiration_date: joinExpiration(cd.expMonth ?? '', cd.expYear ?? ''),
          ...(cd.code ? { cvv: cd.code } : {}),
          ...(it.notes ? { note: it.notes } : {}),
          ...(cf.length ? { custom_fields: cf } : {}),
        },
      } as Content;
    }
    case BW_IDENTITY: {
      const id = it.identity ?? {};
      let extra = cf;
      extra = appendIfValue(extra, 'Title', id.title ?? '', 'text');
      extra = appendIfValue(extra, 'Middle Name', id.middleName ?? '', 'text');
      extra = appendIfValue(extra, 'SSN', id.ssn ?? '', 'hidden');
      extra = appendIfValue(extra, 'Username', id.username ?? '', 'text');
      extra = appendIfValue(extra, 'Passport Number', id.passportNumber ?? '', 'text');
      extra = appendIfValue(extra, 'License Number', id.licenseNumber ?? '', 'text');
      return {
        kind: 'identity',
        data: {
          title: it.name,
          ...(id.firstName ? { first_name: id.firstName } : {}),
          ...(id.lastName ? { last_name: id.lastName } : {}),
          ...(id.email ? { email: id.email } : {}),
          ...(id.phone ? { phone: id.phone } : {}),
          ...(id.company ? { company: id.company } : {}),
          ...(bwJoinAddress(id) ? { address: bwJoinAddress(id) } : {}),
          ...(it.notes ? { note: it.notes } : {}),
          ...(extra.length ? { custom_fields: extra } : {}),
        },
      } as Content;
    }
    case BW_SECURE_NOTE:
      return {
        kind: 'note',
        data: {
          title: it.name,
          body: it.notes ?? '',
          ...(cf.length ? { custom_fields: cf } : {}),
        },
      };
    default:
      // Unknown type with no usable mapping; skip.
      return null;
  }
}

function bwFieldsTo(fields: BwField[] | undefined): Field[] {
  if (!fields || fields.length === 0) return [];
  return fields.map((f) => field(f.name, f.value, f.type === 1 ? 'hidden' : 'text'));
}

function bwJoinAddress(id: BwIdentity): string {
  return [
    id.address1,
    id.address2,
    id.address3,
    id.city,
    id.state,
    id.postalCode,
    id.country,
  ]
    .filter((p) => p && p.trim() !== '')
    .join(', ');
}
