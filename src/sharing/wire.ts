import { b64encode, b64decode } from '../crypto/b64';
import type { ItemType } from '../items/types';
import type {
  WrappedKey,
  Envelope,
  SharePayload,
  Message,
  MessageType,
  SharedLink,
  ShareRecord,
} from './types';

// At-rest JSON shapes for internal/sharing/types.go. Field names and omitempty
// behavior match Go's json tags exactly so records round-trip with the desktop
// app. Byte fields are standard padded base64 (see b64.ts). Field *order* is
// irrelevant — nothing hashes the re-serialized JSON.

// --- WrappedKey ---------------------------------------------------------------

interface WrappedKeyWire {
  recipient_id: string;
  ephemeral_pub: string;
  nonce: string;
  wrapped: string;
}

export function wrappedKeyToWire(wk: WrappedKey): WrappedKeyWire {
  return {
    recipient_id: wk.recipientID,
    ephemeral_pub: b64encode(wk.ephemeralPub),
    nonce: b64encode(wk.nonce),
    wrapped: b64encode(wk.wrapped),
  };
}

export function wrappedKeyFromWire(w: WrappedKeyWire): WrappedKey {
  return {
    recipientID: w.recipient_id,
    ephemeralPub: b64decode(w.ephemeral_pub),
    nonce: b64decode(w.nonce),
    wrapped: b64decode(w.wrapped),
  };
}

/** marshalWrappedKey serializes a WrappedKey to the JSON bytes stored in
 * SharePayload.wrappedKey and SharedLink.wrappedKey. */
export function marshalWrappedKey(wk: WrappedKey): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(wrappedKeyToWire(wk)));
}

/** unmarshalWrappedKey is the inverse of marshalWrappedKey. */
export function unmarshalWrappedKey(b: Uint8Array): WrappedKey {
  return wrappedKeyFromWire(JSON.parse(new TextDecoder().decode(b)) as WrappedKeyWire);
}

// --- Envelope -----------------------------------------------------------------

interface EnvelopeWire {
  id: string;
  type: string;
  owner_id: string;
  format?: number;
  recipients?: WrappedKeyWire[];
  nonce: string;
  ciphertext: string;
  signature?: string;
}

export function envelopeToWire(env: Envelope): EnvelopeWire {
  const w: EnvelopeWire = {
    id: env.id,
    type: env.type,
    owner_id: env.ownerID,
    nonce: b64encode(env.nonce),
    ciphertext: b64encode(env.ciphertext),
  };
  if (env.format !== 0) w.format = env.format;
  if (env.recipients.length > 0) w.recipients = env.recipients.map(wrappedKeyToWire);
  if (env.signature.length > 0) w.signature = b64encode(env.signature);
  return w;
}

export function envelopeFromWire(w: EnvelopeWire): Envelope {
  return {
    id: w.id,
    type: w.type as ItemType,
    ownerID: w.owner_id,
    format: w.format ?? 0,
    recipients: (w.recipients ?? []).map(wrappedKeyFromWire),
    nonce: b64decode(w.nonce),
    ciphertext: b64decode(w.ciphertext),
    signature: w.signature ? b64decode(w.signature) : new Uint8Array(0),
  };
}

// --- SharePayload / Message ---------------------------------------------------

interface SharePayloadWire {
  share_path: string;
  wrapped_key: string;
  item_type: string;
  owner_id: string;
}

interface MessageWire {
  type: string;
  share_id: string;
  sender_id: string;
  env_version: number;
  timestamp: string;
  share?: SharePayloadWire;
  signature?: string;
}

function sharePayloadToWire(p: SharePayload): SharePayloadWire {
  return {
    share_path: p.sharePath,
    wrapped_key: b64encode(p.wrappedKey),
    item_type: p.itemType,
    owner_id: p.ownerID,
  };
}

function sharePayloadFromWire(w: SharePayloadWire): SharePayload {
  return {
    sharePath: w.share_path,
    wrappedKey: b64decode(w.wrapped_key),
    itemType: w.item_type,
    ownerID: w.owner_id,
  };
}

export function messageToWire(msg: Message): MessageWire {
  const w: MessageWire = {
    type: msg.type,
    share_id: msg.shareID,
    sender_id: msg.senderID,
    env_version: msg.envVersion,
    timestamp: msg.timestamp,
  };
  if (msg.share) w.share = sharePayloadToWire(msg.share);
  if (msg.signature.length > 0) w.signature = b64encode(msg.signature);
  return w;
}

export function messageFromWire(w: MessageWire): Message {
  return {
    type: w.type as MessageType,
    shareID: w.share_id,
    senderID: w.sender_id,
    envVersion: w.env_version,
    timestamp: w.timestamp,
    share: w.share ? sharePayloadFromWire(w.share) : undefined,
    signature: w.signature ? b64decode(w.signature) : new Uint8Array(0),
  };
}

// --- SharedLink / ShareRecord -------------------------------------------------

interface SharedLinkWire {
  share_id: string;
  share_path: string;
  wrapped_key: string;
  owner_id: string;
  item_type: string;
  env_version: number;
}

export function sharedLinkToWire(link: SharedLink): SharedLinkWire {
  return {
    share_id: link.shareID,
    share_path: link.sharePath,
    wrapped_key: b64encode(link.wrappedKey),
    owner_id: link.ownerID,
    item_type: link.itemType,
    env_version: link.envVersion,
  };
}

export function sharedLinkFromWire(w: SharedLinkWire): SharedLink {
  return {
    shareID: w.share_id,
    sharePath: w.share_path,
    wrappedKey: b64decode(w.wrapped_key),
    ownerID: w.owner_id,
    itemType: w.item_type,
    envVersion: w.env_version,
  };
}

interface ShareRecordWire {
  share_id: string;
  item_id: string;
  recipient_id: string;
  item_type: string;
}

export function shareRecordToWire(rec: ShareRecord): ShareRecordWire {
  return {
    share_id: rec.shareID,
    item_id: rec.itemID,
    recipient_id: rec.recipientID,
    item_type: rec.itemType,
  };
}

export function shareRecordFromWire(w: ShareRecordWire): ShareRecord {
  return {
    shareID: w.share_id,
    itemID: w.item_id,
    recipientID: w.recipient_id,
    itemType: w.item_type,
  };
}
