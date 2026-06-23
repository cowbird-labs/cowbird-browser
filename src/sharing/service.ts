import { seal, open } from '../crypto/aead';
import { unwrapKey } from '../crypto/wrap';
import { newItemKey } from '../crypto/item';
import type { Identity } from '../crypto/identity';
import { encode } from '../items/codec';
import type { Content } from '../items/types';
import { VaultNotFound } from '../vault/kv';
import type { VaultStore } from '../vault/store';
import {
  contentAAD,
  envelopeAAD,
  findOwnerKey,
  isValidID,
  newEnvelope,
  newID,
  openEnvelope,
  parseSharePath,
  sharePath,
  wrapKeyForRecipient,
} from './envelope';
import { signMessage, verifyMessage } from './signing';
import { marshalWrappedKey, unmarshalWrappedKey } from './wire';
import type {
  Envelope,
  InboxEntry,
  Message,
  PublicKeyEntry,
  SharedLink,
  ShareRecord,
} from './types';

// Mirrors internal/sharing/service.go. Coordinates item creation, editing,
// sharing, revocation, and the consume-and-delete inbox protocol for one user.
// Handlers write/remove durable state before deleting the triggering message, so
// a crash between the two steps self-heals on the next ProcessInbox run.

// Inbox-robustness limits. The inbox is world-writable, so a hostile sender can
// flood it or send oversized messages; these bounds keep one inbox from stalling
// or exhausting a victim.
const MAX_INBOX_PER_RUN = 256;
const MAX_WRAPPED_KEY_LEN = 4096;
const MAX_SHARE_PATH_LEN = 256;
const MAX_ITEM_TYPE_LEN = 64;

async function ignoreNotFound(p: Promise<void>): Promise<void> {
  try {
    await p;
  } catch (err) {
    if (!(err instanceof VaultNotFound)) throw err;
  }
}

export class Service {
  constructor(
    private readonly entityID: string,
    private readonly identity: Identity,
    private readonly store: VaultStore,
  ) {}

  /** createItem encrypts content and stores it in the owner's own subtree. */
  async createItem(content: Content): Promise<Envelope> {
    const { env } = await newEnvelope(this.entityID, this.identity.encryptionPub, content);
    await this.store.putItem(env.id, env);
    return env;
  }

  /** openOwnItem decrypts an item from the owner's own subtree. */
  async openOwnItem(env: Envelope): Promise<Content> {
    const wk = findOwnerKey(env, this.entityID);
    if (!wk) throw new Error(`no wrapped key for ${this.entityID} in item ${env.id}`);
    return openEnvelope(env, this.identity.encryptionPriv, wk);
  }

  /** directory returns all published public keys with their display names. */
  directory(): Promise<PublicKeyEntry[]> {
    return this.store.listPublicKeys();
  }

  listItems(): Promise<Envelope[]> {
    return this.store.listItems();
  }

  listSharedLinks(): Promise<SharedLink[]> {
    return this.store.listSharedLinks();
  }

  /** deleteSharedLink removes a SharedLink; an already-absent link is not an error. */
  async deleteSharedLink(shareID: string): Promise<void> {
    await ignoreNotFound(this.store.deleteSharedLink(shareID));
  }

  /** listShareRecords returns the owner's outgoing shares for itemID. */
  async listShareRecords(itemID: string): Promise<ShareRecord[]> {
    const all = await this.store.listShareRecords();
    return all.filter((rec) => rec.itemID === itemID);
  }

  /**
   * updateItem re-encrypts content under the item's existing key (fresh nonce)
   * and writes the owned envelope back, then rewrites every shared envelope made
   * from the item so recipients see the edit without re-sharing. The item key is
   * unchanged, so recipients' wrapped keys stay valid.
   */
  async updateItem(itemID: string, content: Content): Promise<Envelope> {
    const env = await this.store.getItem(itemID);
    const ownerWK = findOwnerKey(env, this.entityID);
    if (!ownerWK) throw new Error(`no wrapped key for owner in item ${itemID}`);
    const itemKey = await unwrapKey(
      this.identity.encryptionPriv,
      ownerWK.ephemeralPub,
      ownerWK.nonce,
      ownerWK.wrapped,
    );

    const contentBytes = encode(content);
    env.type = content.kind;
    const { nonce, ciphertext } = seal(itemKey, contentBytes, contentAAD(env.ownerID, env.type));
    env.format = 1;
    env.nonce = nonce;
    env.ciphertext = ciphertext;

    await this.store.putItem(itemID, env);

    for (const rec of await this.listShareRecords(itemID)) {
      await this.store.putSharedEnvelope(rec.shareID, { ...env, id: rec.shareID });
    }
    return env;
  }

  /**
   * deleteItem permanently deletes an owned item, revoking every outstanding
   * share first (delete shared copy, send revoke, remove record). Cleanup runs
   * before the owned envelope is deleted and tolerates already-deleted records,
   * so a partial failure is retryable.
   */
  async deleteItem(itemID: string): Promise<void> {
    for (const rec of await this.listShareRecords(itemID)) {
      await this.dropShare(rec.shareID, rec.recipientID);
    }
    await ignoreNotFound(this.store.deleteItem(itemID));
  }

  /**
   * rekey re-encrypts every owned item under a fresh item key wrapped to newPub,
   * then re-distributes each item's new key to its existing recipients. Drives
   * key rotation. Idempotent and resumable: an already-migrated item keeps its
   * key and only has its shares reconciled. Key material is passed explicitly
   * because during rotation the service identity may be the old or new one.
   */
  async rekey(oldPriv: Uint8Array, newPriv: Uint8Array, newPub: Uint8Array): Promise<void> {
    for (const env of await this.store.listItems()) {
      const { migrated, itemKey } = await this.rekeyOwnedItem(env, oldPriv, newPriv, newPub);
      await this.redistributeShares(migrated, itemKey, '');
    }
  }

  private async rekeyOwnedItem(
    env: Envelope,
    oldPriv: Uint8Array,
    newPriv: Uint8Array,
    newPub: Uint8Array,
  ): Promise<{ migrated: Envelope; itemKey: Uint8Array }> {
    const ownerWK = findOwnerKey(env, this.entityID);
    if (!ownerWK) throw new Error(`no owner wrapped key in item ${env.id}`);

    // Already migrated (resume): the owner's wrapped key opens with the new key.
    try {
      const itemKey = await unwrapKey(newPriv, ownerWK.ephemeralPub, ownerWK.nonce, ownerWK.wrapped);
      return { migrated: env, itemKey };
    } catch {
      // Not yet migrated; fall through to reseal under a fresh item key.
    }
    return this.resealUnderNewItemKey(env, oldPriv, newPub);
  }

  /**
   * resealUnderNewItemKey decrypts env's content (reading the owner's wrapped key
   * with readPriv), re-encrypts under a brand-new item key wrapped to ownerPub,
   * writes the envelope back, and returns it with the new key. Always mints a
   * fresh key, which is what makes it usable both for rotation and for revocation
   * re-keying (where the point is to invalidate the previous item key).
   */
  private async resealUnderNewItemKey(
    env: Envelope,
    readPriv: Uint8Array,
    ownerPub: Uint8Array,
  ): Promise<{ migrated: Envelope; itemKey: Uint8Array }> {
    const ownerWK = findOwnerKey(env, this.entityID);
    if (!ownerWK) throw new Error(`no owner wrapped key in item ${env.id}`);
    const oldItemKey = await unwrapKey(
      readPriv,
      ownerWK.ephemeralPub,
      ownerWK.nonce,
      ownerWK.wrapped,
    );
    const plaintext = open(oldItemKey, env.nonce, env.ciphertext, envelopeAAD(env));

    const itemKey = newItemKey();
    const { nonce, ciphertext } = seal(itemKey, plaintext, contentAAD(env.ownerID, env.type));
    const newOwnerWK = await wrapKeyForRecipient(itemKey, this.entityID, ownerPub);

    env.format = 1;
    env.recipients = [newOwnerWK];
    env.nonce = nonce;
    env.ciphertext = ciphertext;
    await this.store.putItem(env.id, env);
    return { migrated: env, itemKey };
  }

  /**
   * redistributeShares rewrites every shared envelope made from env under the new
   * item key and notifies each recipient, wrapping to the recipient's current
   * published key. The share whose ID equals excludeShareID ('' for none) is
   * skipped — used by revocation so the removed recipient is not re-issued the key.
   */
  private async redistributeShares(
    env: Envelope,
    itemKey: Uint8Array,
    excludeShareID: string,
  ): Promise<void> {
    for (const rec of await this.listShareRecords(env.id)) {
      if (rec.shareID === excludeShareID) continue;
      const recipientPub = await this.store.getPublicKey(rec.recipientID);
      const recipientWK = await wrapKeyForRecipient(itemKey, rec.recipientID, recipientPub);
      const recipientWKBytes = marshalWrappedKey(recipientWK);

      const version = await this.store.putSharedEnvelope(rec.shareID, { ...env, id: rec.shareID });

      const msg: Message = {
        type: 'share',
        shareID: rec.shareID,
        senderID: this.entityID,
        envVersion: version,
        timestamp: new Date().toISOString(),
        share: {
          sharePath: sharePath(this.entityID, rec.shareID),
          wrappedKey: recipientWKBytes,
          itemType: env.type,
          ownerID: this.entityID,
        },
        signature: new Uint8Array(0),
      };
      signMessage(this.identity, msg);
      await this.store.sendMessage(rec.recipientID, newID(), msg);
    }
  }

  /**
   * share shares itemID with recipientID: decrypts the owner's item key, wraps it
   * for the recipient, writes a shared envelope (retaining the owner's wrapped
   * key), records the outgoing share, and drops a share message in the inbox.
   */
  async share(itemID: string, recipientID: string): Promise<void> {
    const env = await this.store.getItem(itemID);
    const ownerWK = findOwnerKey(env, this.entityID);
    if (!ownerWK) throw new Error(`no wrapped key for owner in item ${itemID}`);
    const itemKey = await unwrapKey(
      this.identity.encryptionPriv,
      ownerWK.ephemeralPub,
      ownerWK.nonce,
      ownerWK.wrapped,
    );

    const recipientPub = await this.store.getPublicKey(recipientID);
    const recipientWK = await wrapKeyForRecipient(itemKey, recipientID, recipientPub);
    const recipientWKBytes = marshalWrappedKey(recipientWK);

    const shareID = newID();
    const version = await this.store.putSharedEnvelope(shareID, { ...env, id: shareID });

    // Record the outgoing share before notifying, so a failed send still leaves
    // the owner able to find and clean up the envelope.
    await this.store.putShareRecord({
      shareID,
      itemID,
      recipientID,
      itemType: env.type,
    });

    const msg: Message = {
      type: 'share',
      shareID,
      senderID: this.entityID,
      envVersion: version,
      timestamp: new Date().toISOString(),
      share: {
        sharePath: sharePath(this.entityID, shareID),
        wrappedKey: recipientWKBytes,
        itemType: env.type,
        ownerID: this.entityID,
      },
      signature: new Uint8Array(0),
    };
    signMessage(this.identity, msg);
    await this.store.sendMessage(recipientID, newID(), msg);
  }

  /**
   * revoke removes a recipient's access. Deleting their shared copy is necessary
   * but not sufficient (they may have kept the item key, which opens any other
   * recipient's copy), so revoke re-keys the item for the remaining recipients
   * first, then drops the revoked copy, record, and notification. The re-key runs
   * off the still-present share record, so a partial failure is retryable.
   */
  async revoke(shareID: string, recipientID: string): Promise<void> {
    const itemID = await this.itemIDForShare(shareID);
    // '' means the share record is already gone (idempotent retry or unknown
    // share); nothing to re-key, just clean up the copy, record, and notification.
    if (itemID !== '') {
      await this.rekeyItemExcluding(itemID, shareID);
    }
    await this.dropShare(shareID, recipientID);
  }

  private async itemIDForShare(shareID: string): Promise<string> {
    const recs = await this.store.listShareRecords();
    return recs.find((rec) => rec.shareID === shareID)?.itemID ?? '';
  }

  /** rekeyItemExcluding re-encrypts the owned item under a fresh key and
   * redistributes it to every current recipient except excludeShareID. A missing
   * item (already deleted) is a no-op. */
  private async rekeyItemExcluding(itemID: string, excludeShareID: string): Promise<void> {
    let env: Envelope;
    try {
      env = await this.store.getItem(itemID);
    } catch (err) {
      if (err instanceof VaultNotFound) return;
      throw err;
    }
    const { migrated, itemKey } = await this.resealUnderNewItemKey(
      env,
      this.identity.encryptionPriv,
      this.identity.encryptionPub,
    );
    await this.redistributeShares(migrated, itemKey, excludeShareID);
  }

  /** dropShare deletes the recipient's shared copy, sends a revoke message, and
   * removes the owner's ShareRecord. Each step tolerates an absent target, so it
   * is idempotent. It does NOT re-key — callers that need that do it separately. */
  private async dropShare(shareID: string, recipientID: string): Promise<void> {
    await ignoreNotFound(this.store.deleteSharedEnvelope(shareID));

    const msg: Message = {
      type: 'revoke',
      shareID,
      senderID: this.entityID,
      envVersion: 0,
      timestamp: new Date().toISOString(),
      signature: new Uint8Array(0),
    };
    signMessage(this.identity, msg);
    await this.store.sendMessage(recipientID, newID(), msg);

    await ignoreNotFound(this.store.deleteShareRecord(shareID));
  }

  /**
   * processInbox reads pending messages and applies up to MAX_INBOX_PER_RUN of
   * them. Share → write SharedLink then delete; revoke → remove SharedLink then
   * delete. Malformed, oversized, forged, or unknown messages are discarded
   * (never aborting the run), so one hostile message cannot block startup.
   */
  async processInbox(): Promise<void> {
    const entries = await this.store.listInboxMessages();
    for (let i = 0; i < entries.length && i < MAX_INBOX_PER_RUN; i++) {
      await this.processEntry(entries[i]!);
    }
  }

  /** openSharedItem fetches the shared envelope identified by link and decrypts
   * it using the recipient's wrapped key stored in the link. */
  async openSharedItem(link: SharedLink): Promise<Content> {
    const wk = unmarshalWrappedKey(link.wrappedKey);
    const { ownerID, shareID } = parseSharePath(link.sharePath);
    const { env } = await this.store.getSharedEnvelope(ownerID, shareID);
    return openEnvelope(env, this.identity.encryptionPriv, wk);
  }

  private async processEntry(entry: InboxEntry): Promise<void> {
    switch (entry.msg.type) {
      case 'share':
        return this.processShare(entry);
      case 'revoke':
        return this.processRevoke(entry);
      default:
        // Unknown type — discard rather than abort the whole inbox.
        return this.store.deleteInboxMessage(entry.id);
    }
  }

  private async processShare(entry: InboxEntry): Promise<void> {
    const share = entry.msg.share;
    if (!share || !shareWithinLimits(share)) {
      return this.store.deleteInboxMessage(entry.id);
    }

    // shareID is attacker-controlled and keys the stored SharedLink path; reject
    // anything not UUID-shaped before it reaches path construction.
    if (!isValidID(entry.msg.shareID)) {
      return this.store.deleteInboxMessage(entry.id);
    }

    // Authenticity (path): the shared envelope's storage path is the only owner
    // attribution Vault enforces. A self-asserted OwnerID disagreeing with the
    // path, or a malformed path, is a forgery.
    let pathOwner: string;
    try {
      pathOwner = parseSharePath(share.sharePath).ownerID;
    } catch {
      return this.store.deleteInboxMessage(entry.id);
    }
    if (pathOwner !== share.ownerID) {
      return this.store.deleteInboxMessage(entry.id);
    }

    // Authenticity (signature): the share must be signed by the path owner. A
    // legacy owner with no signing key falls back to the path-authority check.
    const { ok, legacy } = await verifyMessage(this.store, pathOwner, entry.msg);
    if (!ok && !legacy) {
      return this.store.deleteInboxMessage(entry.id);
    }

    // Idempotency: a link at this version or newer means skip the write.
    try {
      const existing = await this.store.getSharedLink(entry.msg.shareID);
      if (existing.envVersion >= entry.msg.envVersion) {
        return this.store.deleteInboxMessage(entry.id);
      }
    } catch (err) {
      if (!(err instanceof VaultNotFound)) throw err;
    }

    const link: SharedLink = {
      shareID: entry.msg.shareID,
      sharePath: share.sharePath,
      wrappedKey: share.wrappedKey,
      ownerID: pathOwner,
      itemType: share.itemType,
      envVersion: entry.msg.envVersion,
    };
    // Write link first — a crash before the delete re-enters and the idempotency
    // check skips the rewrite.
    await this.store.putSharedLink(link);
    return this.store.deleteInboxMessage(entry.id);
  }

  private async processRevoke(entry: InboxEntry): Promise<void> {
    // shareID is attacker-controlled and is used to look up the link by path.
    if (!isValidID(entry.msg.shareID)) {
      return this.store.deleteInboxMessage(entry.id);
    }

    let link: SharedLink;
    try {
      link = await this.store.getSharedLink(entry.msg.shareID);
    } catch (err) {
      // No link to remove (already revoked, or never had it) — consume the message.
      if (err instanceof VaultNotFound) return this.store.deleteInboxMessage(entry.id);
      throw err;
    }

    // Authenticity: a revoke must be signed by the owner who shared the item, or
    // a forged revoke could delete a legitimate link. A legacy owner is trusted.
    const { ok, legacy } = await verifyMessage(this.store, link.ownerID, entry.msg);
    if (!ok && !legacy) {
      // Forged or downgraded revoke — discard it and keep the link.
      return this.store.deleteInboxMessage(entry.id);
    }

    await ignoreNotFound(this.store.deleteSharedLink(entry.msg.shareID));
    return this.store.deleteInboxMessage(entry.id);
  }
}

/** shareWithinLimits reports whether a share payload's sizes are sane. */
function shareWithinLimits(p: { wrappedKey: Uint8Array; sharePath: string; itemType: string }): boolean {
  return (
    p.wrappedKey.length <= MAX_WRAPPED_KEY_LEN &&
    p.sharePath.length <= MAX_SHARE_PATH_LEN &&
    p.itemType.length <= MAX_ITEM_TYPE_LEN
  );
}
