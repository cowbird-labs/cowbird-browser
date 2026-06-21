import { encode } from '../items/codec';
import { fromUtf8 } from '../crypto/b64';
import type { App } from './app';
import type { Codec } from '../transfer/types';

// Bulk item import/export and de-duplication, a port of internal/core/transfer.go.
// Crypto/Vault orchestration stays here; format adapters live in ../transfer.

export interface ImportResult {
  imported: number;
  skipped: number;
}

/**
 * exportItems decrypts every item the user owns and serializes them with codec.
 * Items that cannot be decrypted are skipped rather than aborting the export
 * (mirroring how the item list tolerates unreadable rows). The returned bytes
 * contain secrets in the clear; the caller must warn the user before persisting.
 */
export async function exportItems(app: App, codec: Codec): Promise<Uint8Array> {
  const contents = [];
  for (const env of await app.service.listItems()) {
    try {
      contents.push(await app.service.openOwnItem(env));
    } catch {
      // Undecryptable owned item (e.g. an unreadable row); skip it.
    }
  }
  return codec.marshal(contents);
}

/**
 * importItems parses data in codec's format and creates each item it contains as
 * a new owned item encrypted to the importing user's key. The file is fully
 * validated before anything is written (a malformed/mismatched file imports
 * nothing). Undecodable entries (counted by the codec) and items the store
 * refuses are reported as skips; the import does not abort on them. Imported
 * items get fresh IDs; importing the same file twice creates duplicates.
 */
export async function importItems(
  app: App,
  codec: Codec,
  data: Uint8Array,
): Promise<ImportResult> {
  const { contents, skipped } = await codec.unmarshal(data);
  const res: ImportResult = { imported: 0, skipped };
  for (const content of contents) {
    try {
      await app.service.createItem(content);
      res.imported++;
    } catch {
      res.skipped++;
    }
  }
  return res;
}

/**
 * removeDuplicateItems finds owned items whose decrypted content is identical to
 * one already seen and, unless dryRun is set, deletes the extra copies (keeping
 * one of each). Equality is exact: the full encoded content must match, so
 * distinct items are never merged. Undecryptable items are ignored. Deletion goes
 * through the service, so any shares of a removed copy are revoked too. Returns
 * how many duplicate copies were found (dryRun) or removed.
 */
export async function removeDuplicateItems(app: App, dryRun: boolean): Promise<number> {
  const seen = new Set<string>();
  let count = 0;
  for (const env of await app.service.listItems()) {
    let key: string;
    try {
      key = fromUtf8(encode(await app.service.openOwnItem(env)));
    } catch {
      continue; // undecryptable; leave it alone
    }
    if (!seen.has(key)) {
      seen.add(key);
      continue;
    }
    count++;
    if (dryRun) continue;
    await app.service.deleteItem(env.id);
  }
  return count;
}
