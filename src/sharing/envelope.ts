import { newItemKey } from '../crypto/item';
import { seal, open } from '../crypto/aead';
import { wrapKey, unwrapKey } from '../crypto/wrap';
import { utf8 } from '../crypto/b64';
import { encode, decode } from '../items/codec';
import type { Content, ItemType } from '../items/types';
import type { Envelope, WrappedKey } from './types';

// Mirrors internal/sharing/envelope.go. The content AEAD binds only fields
// identical across the owner's copy and every shared copy — OwnerID and Type —
// so the single shared ciphertext opens under each copy. ID is excluded because
// shared copies reuse the owner's ciphertext under a different ID (the shareID).

const CONTENT_FORMAT_AAD = 1;

/** contentAAD is the associated data binding item content to its envelope. */
export function contentAAD(ownerID: string, type: ItemType): Uint8Array {
  const owner = utf8(ownerID);
  const typ = utf8(type);
  const aad = new Uint8Array(owner.length + 1 + typ.length);
  aad.set(owner, 0);
  aad[owner.length] = 0; // separator; neither field contains a NUL
  aad.set(typ, owner.length + 1);
  return aad;
}

/** envelopeAAD returns the AAD to authenticate when opening env, honoring its
 * format so legacy (nil-AAD, format 0) envelopes still decrypt. */
export function envelopeAAD(env: Envelope): Uint8Array | null {
  if (env.format < CONTENT_FORMAT_AAD) return null;
  return contentAAD(env.ownerID, env.type);
}

/** newEnvelope creates an encrypted Envelope for content owned by ownerID. The
 * owner's wrapped item key is placed in recipients[0]; the plaintext item key is
 * also returned so the caller can wrap it for more recipients without re-opening. */
export async function newEnvelope(
  ownerID: string,
  ownerPub: Uint8Array,
  content: Content,
): Promise<{ env: Envelope; itemKey: Uint8Array }> {
  const itemKey = newItemKey();
  const contentBytes = encode(content);
  const { nonce, ciphertext } = seal(itemKey, contentBytes, contentAAD(ownerID, content.kind));
  const ownerWK = await wrapKeyForRecipient(itemKey, ownerID, ownerPub);
  const env: Envelope = {
    id: newID(),
    type: content.kind,
    ownerID,
    format: CONTENT_FORMAT_AAD,
    recipients: [ownerWK],
    nonce,
    ciphertext,
    signature: new Uint8Array(0),
  };
  return { env, itemKey };
}

/** openEnvelope decrypts an Envelope using the recipient's private key and their WrappedKey. */
export async function openEnvelope(
  env: Envelope,
  recipientPriv: Uint8Array,
  wk: WrappedKey,
): Promise<Content> {
  const itemKey = await unwrapKey(recipientPriv, wk.ephemeralPub, wk.nonce, wk.wrapped);
  const contentBytes = open(itemKey, env.nonce, env.ciphertext, envelopeAAD(env));
  return decode(contentBytes);
}

/** wrapKeyForRecipient wraps itemKey to a recipient's X25519 public key. */
export async function wrapKeyForRecipient(
  itemKey: Uint8Array,
  recipientID: string,
  recipientPub: Uint8Array,
): Promise<WrappedKey> {
  const { ephemeralPub, nonce, wrapped } = await wrapKey(recipientPub, itemKey);
  return { recipientID, ephemeralPub, nonce, wrapped };
}

/** findOwnerKey returns the owner's WrappedKey from an envelope's recipients. */
export function findOwnerKey(env: Envelope, ownerID: string): WrappedKey | undefined {
  return env.recipients.find((wk) => wk.recipientID === ownerID);
}

/** newID returns a random UUID v4 (matches Go's newID format). */
export function newID(): string {
  return crypto.randomUUID();
}

export const CONTENT_FORMAT = CONTENT_FORMAT_AAD;

export function sharePath(ownerID: string, shareID: string): string {
  return `${ownerID}/${shareID}`;
}

export function parseSharePath(path: string): { ownerID: string; shareID: string } {
  const i = path.indexOf('/');
  if (i < 0) throw new Error(`invalid share path ${JSON.stringify(path)}: expected ownerID/shareID`);
  return { ownerID: path.slice(0, i), shareID: path.slice(i + 1) };
}
