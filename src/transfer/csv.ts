// Minimal RFC 4180 CSV reader/writer matching Go's encoding/csv defaults
// (comma delimiter, "\n" terminator, double-quote escaping). Used by the
// LastPass codec.

function csvField(s: string): string {
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** writeCsv renders rows to CSV text, terminating every record with "\n". */
export function writeCsv(rows: string[][]): string {
  if (rows.length === 0) return '';
  return rows.map((row) => row.map(csvField).join(',')).join('\n') + '\n';
}

/**
 * parseCsv parses CSV text into rows of fields. It handles quoted fields with
 * embedded commas, newlines, and doubled quotes, and tolerates both "\n" and
 * "\r\n" line endings. Fully blank lines are ignored (as Go's reader does).
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let started = false;
  const n = text.length;

  const endRow = () => {
    row.push(field);
    field = '';
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
    started = false;
  };

  for (let i = 0; i < n; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      started = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      started = true;
    } else if (ch === '\r') {
      // swallow; the following \n (if any) ends the row
    } else if (ch === '\n') {
      endRow();
    } else {
      field += ch;
      started = true;
    }
  }
  if (started || field !== '' || row.length > 0) endRow();
  return rows;
}
