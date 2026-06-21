import { utf8, fromUtf8 } from '../crypto/b64';
import { contentFromEnvelope } from './codec';
import type { Content } from './types';

// Mirrors internal/items/transfer.go. The cowbird-native bulk export: a
// self-describing JSON document (format tag + version) wrapping a list of
// {type, data} item envelopes, so it round-trips losslessly through decodeExport
// and is interchangeable with the desktop app's export files.

// EXPORT_FORMAT tags a cowbird export document so import can reject foreign or
// unrelated JSON before decoding any items.
export const EXPORT_FORMAT = 'cowbird-export';

// EXPORT_VERSION is the current export schema version. Bump on any incompatible
// change; decodeExport rejects versions it does not understand.
export const EXPORT_VERSION = 1;

interface ExportEntry {
  type: string;
  data: unknown;
}

interface ExportFile {
  format: string;
  version: number;
  exported_at: string;
  items: ExportEntry[];
}

/**
 * encodeExport serializes contents into an indented cowbird export document.
 * Field order matches the Go struct (format, version, exported_at, items); field
 * order is not significant for import, only the names and the format/version tags.
 */
export function encodeExport(contents: Content[]): Uint8Array {
  const file: ExportFile = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    items: contents.map((c) => ({ type: c.kind, data: c.data })),
  };
  return utf8(JSON.stringify(file, null, 2));
}

/**
 * decodeExport parses a cowbird export document and returns its items. The whole
 * document is validated (format tag and version) before any entry is decoded, so
 * a file cowbird does not recognise is rejected without partial results.
 * Individual entries that fail to decode are skipped and counted rather than
 * aborting the import.
 */
export function decodeExport(bytes: Uint8Array): { contents: Content[]; skipped: number } {
  let file: Partial<ExportFile>;
  try {
    file = JSON.parse(fromUtf8(bytes)) as Partial<ExportFile>;
  } catch (e) {
    throw new Error(`parsing export file: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (file.format !== EXPORT_FORMAT) {
    throw new Error(`not a cowbird export file (format ${JSON.stringify(file.format)})`);
  }
  if (file.version !== EXPORT_VERSION) {
    throw new Error(`unsupported export version ${file.version} (expected ${EXPORT_VERSION})`);
  }

  const contents: Content[] = [];
  let skipped = 0;
  for (const raw of file.items ?? []) {
    try {
      contents.push(contentFromEnvelope(raw));
    } catch {
      skipped++;
    }
  }
  return { contents, skipped };
}
