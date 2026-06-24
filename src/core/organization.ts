import { sealToSelf, openFromSelf } from '../crypto/self';
import { utf8 } from '../crypto/b64';
import { VaultNotFound } from '../vault/kv';
import { Organization, newOrganization, parseOrganization } from '../organization/index';
import type { App } from './app';

// Mirrors internal/core/organization.go: load/save orchestration for the user's
// private organization overlay (favorites and labels). The record is encrypted to
// the user's own in-memory key (crypto.sealToSelf), so no password prompt is
// needed per toggle and the storage operator never sees its plaintext.

/**
 * loadOrganization retrieves and decrypts the user's organization overlay. A user
 * who has never saved organization yet gets a fresh empty record rather than an
 * error.
 */
export async function loadOrganization(app: App): Promise<Organization> {
  let sealed;
  try {
    sealed = await app.session.store.getOrganization();
  } catch (err) {
    if (err instanceof VaultNotFound) return newOrganization();
    throw err;
  }
  const plaintext = await openFromSelf(app.identity, sealed);
  return parseOrganization(plaintext);
}

/** saveOrganization encrypts and stores the user's organization overlay. */
export async function saveOrganization(app: App, org: Organization): Promise<void> {
  const plaintext = utf8(JSON.stringify(org.json()));
  const sealed = await sealToSelf(app.identity, plaintext);
  await app.session.store.putOrganization(sealed);
}
