import { utf8, fromUtf8 } from '../crypto/b64';
import type { Content } from '../items/types';
import type { Codec } from './types';
import { customFieldsOf, titleOf } from './mapping';
import { parseCsv, writeCsv } from './csv';

// LastPass CSV export, a port of internal/transfer/lastpass.go. Header:
// url,username,password,totp,extra,name,grouping,fav. Secure notes are encoded
// with url == "http://sn" and the body in the extra column. LastPass logins have
// no native custom-field facility, so cowbird custom fields and any card/identity
// structure are flattened into the extra column as "Label: Value" lines — lossy,
// and re-imported as a single note body.

const LP_NOTE_URL = 'http://sn';
const LP_HEADER = ['url', 'username', 'password', 'totp', 'extra', 'name', 'grouping', 'fav'];

export const lastPassCodec: Codec = {
  id: 'lastpass',
  name: 'LastPass (CSV)',
  extension: '.csv',

  marshal(contents) {
    const rows = [LP_HEADER, ...contents.map(lpRowFrom)];
    return Promise.resolve(utf8(writeCsv(rows)));
  },

  async unmarshal(data) {
    const rows = parseCsv(fromUtf8(data));
    if (rows.length === 0) throw new Error('reading LastPass CSV header: empty file');
    const header = rows[0]!;
    const col = new Map<string, number>();
    header.forEach((h, i) => col.set(h.trim().toLowerCase(), i));
    if (!col.has('name')) throw new Error('not a LastPass CSV (missing name column)');

    const get = (rec: string[], key: string): string => {
      const i = col.get(key);
      if (i === undefined || i >= rec.length) return '';
      return rec[i]!;
    };

    const contents: Content[] = [];
    for (const rec of rows.slice(1)) {
      contents.push(
        lpRowTo(
          get(rec, 'url'),
          get(rec, 'username'),
          get(rec, 'password'),
          get(rec, 'totp'),
          get(rec, 'extra'),
          get(rec, 'name'),
        ),
      );
    }
    // parseCsv already drops malformed/blank lines, so there is nothing extra to
    // count as skipped here.
    return Promise.resolve({ contents, skipped: 0 });
  },
};

// --- cowbird → LastPass ------------------------------------------------------

function lpRowFrom(c: Content): string[] {
  // columns: url, username, password, totp, extra, name, grouping, fav
  const row = ['', '', '', '', '', titleOf(c), '', '0'];
  switch (c.kind) {
    case 'login':
      if ((c.data.urls?.length ?? 0) > 0) row[0] = c.data.urls![0]!;
      row[1] = c.data.username ?? '';
      row[2] = c.data.password ?? '';
      row[3] = c.data.totp ?? '';
      row[4] = lpLoginExtra(c);
      break;
    case 'password':
      row[2] = c.data.password ?? '';
      row[4] = c.data.note ?? '';
      break;
    default:
      // Note, Card, Identity, Custom → secure note; fields flattened to extra.
      row[0] = LP_NOTE_URL;
      row[4] = lpNoteExtra(c);
      break;
  }
  return row;
}

// lpLoginExtra builds a login's extra column: its note, then any extra URLs and
// custom fields as labelled lines (LastPass logins cannot carry these natively).
function lpLoginExtra(c: Content & { kind: 'login' }): string {
  const lines: string[] = [];
  let out = c.data.note ?? '';
  for (const u of (c.data.urls ?? []).slice(1)) appendLine(lines, 'URL', u);
  for (const f of c.data.custom_fields ?? []) appendLine(lines, f.label, f.value);
  if (lines.length) out = out + (out ? '\n' : '') + lines.join('\n');
  return out;
}

// lpNoteExtra serializes a non-login item's full content into the extra column.
function lpNoteExtra(c: Content): string {
  const lines: string[] = [];
  if (c.kind === 'note') {
    if (c.data.body) lines.push(c.data.body);
  } else if (c.kind === 'card') {
    appendLine(lines, 'Cardholder', c.data.cardholder ?? '');
    appendLine(lines, 'Number', c.data.number ?? '');
    appendLine(lines, 'Expiration', c.data.expiration_date ?? '');
    appendLine(lines, 'CVV', c.data.cvv ?? '');
    appendLine(lines, 'PIN', c.data.pin ?? '');
    appendLine(lines, 'Note', c.data.note ?? '');
  } else if (c.kind === 'identity') {
    appendLine(lines, 'First Name', c.data.first_name ?? '');
    appendLine(lines, 'Last Name', c.data.last_name ?? '');
    appendLine(lines, 'Email', c.data.email ?? '');
    appendLine(lines, 'Phone', c.data.phone ?? '');
    appendLine(lines, 'Address', c.data.address ?? '');
    appendLine(lines, 'Company', c.data.company ?? '');
    appendLine(lines, 'Job Title', c.data.job_title ?? '');
    appendLine(lines, 'Note', c.data.note ?? '');
  }
  for (const f of customFieldsOf(c)) appendLine(lines, f.label, f.value);
  return lines.join('\n');
}



function appendLine(lines: string[], label: string, value: string): void {
  if (value === '') return;
  lines.push(`${label}: ${value}`);
}

// --- LastPass → cowbird ------------------------------------------------------

function lpRowTo(
  url: string,
  username: string,
  password: string,
  totp: string,
  extra: string,
  name: string,
): Content {
  if (url.trim().toLowerCase() === LP_NOTE_URL) {
    return { kind: 'note', data: { title: name, body: extra } };
  }
  const urls = url.trim() !== '' ? [url] : undefined;
  return {
    kind: 'login',
    data: {
      title: name,
      username,
      password,
      ...(urls ? { urls } : {}),
      ...(totp ? { totp } : {}),
      ...(extra ? { note: extra } : {}),
    },
  };
}
