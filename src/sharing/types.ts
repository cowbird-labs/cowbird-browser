import type { ItemType } from '../items/types';

// In-memory mirrors of internal/sharing/types.go. Byte fields are Uint8Array;
// the at-rest JSON form (base64 fields, Go json tags) lives in ./wire.ts.

export type MessageType = 'share' | 'revoke';

/** WrappedKey holds an item key encrypted to a recipient's X25519 public key. */
export interface WrappedKey {
  recipientID: string;
  ephemeralPub: Uint8Array;
  nonce: Uint8Array;
  wrapped: Uint8Array;
}

/**
 * Envelope is the at-rest encrypted form of an item. Recipients holds the
 * owner's wrapped copy of the item key; for shared items the recipient's wrapped
 * key travels via the inbox, not here. format selects the content-AEAD format
 * (0 = legacy nil-AAD, 1 = content bound to owner+type).
 */
export interface Envelope {
  id: string;
  type: ItemType;
  ownerID: string;
  format: number;
  recipients: WrappedKey[];
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  signature: Uint8Array; // deferred authorship signing; usually empty
}

/** SharePayload carries what a recipient needs to access a newly shared item. */
export interface SharePayload {
  sharePath: string; // ownerID/shareID
  wrappedKey: Uint8Array; // JSON-encoded WrappedKey for the recipient
  itemType: string;
  ownerID: string;
}

/** Message is a consume-and-delete inbox message written by the sender. */
export interface Message {
  type: MessageType;
  shareID: string;
  senderID: string; // informational
  envVersion: number; // KV v2 version; ordering tiebreaker
  timestamp: string; // RFC3339; display only
  share?: SharePayload; // share messages only
  signature: Uint8Array; // sender's Ed25519 signature; empty for legacy senders
}

/** SharedLink is a recipient's durable record of an item shared with them. */
export interface SharedLink {
  shareID: string;
  sharePath: string;
  wrappedKey: Uint8Array; // JSON-encoded WrappedKey for this recipient
  ownerID: string;
  itemType: string;
  envVersion: number;
}

/** ShareRecord is the owner's durable record of one outgoing share. */
export interface ShareRecord {
  shareID: string;
  itemID: string;
  recipientID: string;
  itemType: string;
}

/** InboxEntry pairs a Message with the Vault key needed to delete it. */
export interface InboxEntry {
  id: string;
  msg: Message;
}

/** PublicKeyEntry is one entry in the public-key directory. */
export interface PublicKeyEntry {
  entityID: string;
  pub: Uint8Array;
  sigPub: Uint8Array; // Ed25519 signing key; may be empty (pre-008 identities)
  name: string;
}
