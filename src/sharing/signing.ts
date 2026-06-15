import { sodium } from '../crypto/sodium';
import { utf8 } from '../crypto/b64';
import type { Identity } from '../crypto/identity';
import { VaultNotFound } from '../vault/kv';
import type { VaultStore } from '../vault/store';
import type { Message } from './types';

// Mirrors internal/sharing/signing.go. The signed byte string is a custom,
// deterministic, length-prefixed encoding (NOT JSON) with a domain-separation
// prefix. The signer is identified out of band (the share path's owner for
// shares, the link's owner for revokes), so SenderID and Timestamp are excluded.

const ED25519_SK_BYTES = 64;

function writeField(chunks: Uint8Array[], p: Uint8Array): void {
  const n = new Uint8Array(4);
  new DataView(n.buffer).setUint32(0, p.length, false); // big-endian
  chunks.push(n, p);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** signingBytes produces the canonical byte string a message's signature covers. */
export function signingBytes(msg: Message): Uint8Array {
  const chunks: Uint8Array[] = [];
  chunks.push(utf8('cowbird-msg-v1\x00'));
  writeField(chunks, utf8(msg.type));
  writeField(chunks, utf8(msg.shareID));
  const ver = new Uint8Array(8);
  new DataView(ver.buffer).setBigUint64(0, BigInt(msg.envVersion), false); // big-endian
  chunks.push(ver);
  if (msg.share) {
    writeField(chunks, utf8(msg.share.sharePath));
    writeField(chunks, utf8(msg.share.ownerID));
    writeField(chunks, utf8(msg.share.itemType));
    chunks.push(sodium.crypto_hash_sha256(msg.share.wrappedKey));
  }
  return concat(chunks);
}

/** signMessage attaches the sender's signature to msg in place. A legacy identity
 * with no signing key leaves the message unsigned (recipients accept it only via
 * the legacy fallback in verifyMessage). */
export function signMessage(identity: Identity, msg: Message): void {
  if (identity.signingPriv.length !== ED25519_SK_BYTES) return;
  msg.signature = sodium.crypto_sign_detached(signingBytes(msg), identity.signingPriv);
}

export interface VerifyResult {
  /** ok: the message may be trusted (valid signature). */
  ok: boolean;
  /** legacy: claimedSigner has no published signing key; fall back to other authority. */
  legacy: boolean;
}

/**
 * verifyMessage checks that msg is authentic as coming from claimedSigner. It
 * throws only on infrastructure failure (the caller should retry, not discard),
 * so a transient outage cannot drop a real message.
 */
export async function verifyMessage(
  store: VaultStore,
  claimedSigner: string,
  msg: Message,
): Promise<VerifyResult> {
  let sigPub: Uint8Array;
  try {
    sigPub = await store.getSigningKey(claimedSigner);
  } catch (err) {
    if (err instanceof VaultNotFound) return { ok: false, legacy: true };
    throw err;
  }
  if (msg.signature.length === 0) {
    // Signer has a published key but the message is unsigned — a downgrade; reject.
    return { ok: false, legacy: false };
  }
  return { ok: sodium.crypto_sign_verify_detached(msg.signature, signingBytes(msg), sigPub), legacy: false };
}
