import type { LockedIdentity } from '../crypto/identity';
import type {
  Envelope,
  InboxEntry,
  Message,
  PublicKeyEntry,
  SharedLink,
  ShareRecord,
} from '../sharing/types';
import {
  envelopeFromWire,
  envelopeToWire,
  messageFromWire,
  messageToWire,
  sharedLinkFromWire,
  sharedLinkToWire,
  shareRecordFromWire,
  shareRecordToWire,
} from '../sharing/wire';
import { isValidID } from '../sharing/envelope';
import { VaultNotFound, type KV } from './kv';

/** assertID guards a path segment that may carry externally-supplied data,
 * rejecting anything not UUID-shaped before it is concatenated into a KV path.
 * Defense-in-depth behind the sharing service's trust-boundary checks. */
function assertID(id: string, label: string): void {
  if (!isValidID(id)) throw new Error(`invalid ${label}: ${JSON.stringify(id)}`);
}
import type { SelfSealed } from '../crypto/self';
import {
  lockedIdentityFromWire,
  lockedIdentityToWire,
  publicKeyEntryFromWire,
  pubkeyRecordToWire,
  selfSealedFromWire,
  selfSealedToWire,
  type PubkeyRecordWire,
  type SelfSealedWire,
} from './records';

// VaultStore implements the storage surface the sharing service and core layer
// need (mirrors vault/store.go + vault/identity.go), translating typed records
// to/from their at-rest wire form over a KV backend. Paths are scoped to the
// authenticated entity, whose ID is encoded in the Vault token.

export class VaultStore {
  constructor(
    public readonly kv: KV,
    public readonly entityID: string,
  ) {}

  // --- own items (users/<entityID>/items/<itemID>) ---------------------------

  private itemPath(itemID: string): string {
    return `users/${this.entityID}/items/${itemID}`;
  }

  async putItem(itemID: string, env: Envelope): Promise<void> {
    await this.kv.write(this.itemPath(itemID), envelopeToWire(env));
  }

  async getItem(itemID: string): Promise<Envelope> {
    const { value } = await this.kv.read(this.itemPath(itemID));
    return envelopeFromWire(value as never);
  }

  async deleteItem(itemID: string): Promise<void> {
    await this.kv.delete(this.itemPath(itemID));
  }

  async listItems(): Promise<Envelope[]> {
    const keys = await this.kv.list(`users/${this.entityID}/items`);
    return Promise.all(keys.map((key) => this.getItem(key)));
  }

  // --- public-key directory (pubkeys/<entityID>) -----------------------------

  async getPublicKey(entityID: string): Promise<Uint8Array> {
    const { value } = await this.kv.read(`pubkeys/${entityID}`);
    return publicKeyEntryFromWire(entityID, value as PubkeyRecordWire).pub;
  }

  async getSigningKey(entityID: string): Promise<Uint8Array> {
    const { value } = await this.kv.read(`pubkeys/${entityID}`);
    const entry = publicKeyEntryFromWire(entityID, value as PubkeyRecordWire);
    // Identity published before signing keys existed (008 migration window).
    if (entry.sigPub.length === 0) throw new VaultNotFound(`signing key for ${entityID}`);
    return entry.sigPub;
  }

  async putPublicKey(
    entityID: string,
    pub: Uint8Array,
    sigPub: Uint8Array,
    name: string,
  ): Promise<void> {
    await this.kv.write(`pubkeys/${entityID}`, pubkeyRecordToWire(pub, sigPub, name));
  }

  async listPublicKeys(): Promise<PublicKeyEntry[]> {
    const ids = await this.kv.list('pubkeys');
    return Promise.all(
      ids.map(async (entityID) => {
        const { value } = await this.kv.read(`pubkeys/${entityID}`);
        return publicKeyEntryFromWire(entityID, value as PubkeyRecordWire);
      }),
    );
  }

  // --- shared envelopes (shared/<ownerEntityID>/<shareID>) -------------------

  private sharedPath(shareID: string): string {
    assertID(shareID, 'shareID');
    return `shared/${this.entityID}/${shareID}`;
  }

  async putSharedEnvelope(shareID: string, env: Envelope): Promise<number> {
    return this.kv.write(this.sharedPath(shareID), envelopeToWire(env));
  }

  async getSharedEnvelope(
    ownerID: string,
    shareID: string,
  ): Promise<{ env: Envelope; version: number }> {
    assertID(ownerID, 'ownerID');
    assertID(shareID, 'shareID');
    const { value, version } = await this.kv.read(`shared/${ownerID}/${shareID}`);
    return { env: envelopeFromWire(value as never), version };
  }

  async deleteSharedEnvelope(shareID: string): Promise<void> {
    await this.kv.delete(this.sharedPath(shareID));
  }

  // --- inbox (inbox/<recipientEntityID>/<msgID>) -----------------------------

  async sendMessage(recipientID: string, msgID: string, msg: Message): Promise<void> {
    await this.kv.write(`inbox/${recipientID}/${msgID}`, messageToWire(msg));
  }

  async listInboxMessages(): Promise<InboxEntry[]> {
    const keys = await this.kv.list(`inbox/${this.entityID}`);
    return Promise.all(
      keys.map(async (id) => {
        const { value } = await this.kv.read(`inbox/${this.entityID}/${id}`);
        return { id, msg: messageFromWire(value as never) };
      }),
    );
  }

  async deleteInboxMessage(msgID: string): Promise<void> {
    await this.kv.delete(`inbox/${this.entityID}/${msgID}`);
  }

  // --- shared links (users/<entityID>/links/<shareID>) -----------------------

  private linkPath(shareID: string): string {
    assertID(shareID, 'shareID');
    return `users/${this.entityID}/links/${shareID}`;
  }

  async putSharedLink(link: SharedLink): Promise<void> {
    await this.kv.write(this.linkPath(link.shareID), sharedLinkToWire(link));
  }

  async getSharedLink(shareID: string): Promise<SharedLink> {
    const { value } = await this.kv.read(this.linkPath(shareID));
    return sharedLinkFromWire(value as never);
  }

  async deleteSharedLink(shareID: string): Promise<void> {
    await this.kv.delete(this.linkPath(shareID));
  }

  async listSharedLinks(): Promise<SharedLink[]> {
    const keys = await this.kv.list(`users/${this.entityID}/links`);
    return Promise.all(keys.map((key) => this.getSharedLink(key)));
  }

  // --- share records (users/<entityID>/shares/<shareID>) ---------------------

  private shareRecordPath(shareID: string): string {
    return `users/${this.entityID}/shares/${shareID}`;
  }

  async putShareRecord(rec: ShareRecord): Promise<void> {
    await this.kv.write(this.shareRecordPath(rec.shareID), shareRecordToWire(rec));
  }

  async listShareRecords(): Promise<ShareRecord[]> {
    const keys = await this.kv.list(`users/${this.entityID}/shares`);
    return Promise.all(
      keys.map(async (key) => {
        const { value } = await this.kv.read(this.shareRecordPath(key));
        return shareRecordFromWire(value as never);
      }),
    );
  }

  async deleteShareRecord(shareID: string): Promise<void> {
    await this.kv.delete(this.shareRecordPath(shareID));
  }

  // --- locked identity (users/<entityID>/identity[.prev]) --------------------

  private identityPath(suffix = ''): string {
    return `users/${this.entityID}/identity${suffix}`;
  }

  async getLockedIdentity(): Promise<LockedIdentity> {
    const { value } = await this.kv.read(this.identityPath());
    return lockedIdentityFromWire(value as never);
  }

  async putLockedIdentity(locked: LockedIdentity): Promise<void> {
    await this.kv.write(this.identityPath(), lockedIdentityToWire(locked));
  }

  async getPrevLockedIdentity(): Promise<LockedIdentity> {
    const { value } = await this.kv.read(this.identityPath('.prev'));
    return lockedIdentityFromWire(value as never);
  }

  async putPrevLockedIdentity(locked: LockedIdentity): Promise<void> {
    await this.kv.write(this.identityPath('.prev'), lockedIdentityToWire(locked));
  }

  async deletePrevLockedIdentity(): Promise<void> {
    await this.kv.delete(this.identityPath('.prev'));
  }

  // --- organization overlay (users/<entityID>/organization) ------------------
  // The per-user encrypted favorites/labels record. Vault only ever sees the
  // sealed blob; the plaintext stays on the client. Read throws VaultNotFound
  // when none has been stored yet (the core layer treats that as "empty").

  private organizationPath(): string {
    return `users/${this.entityID}/organization`;
  }

  async getOrganization(): Promise<SelfSealed> {
    const { value } = await this.kv.read(this.organizationPath());
    return selfSealedFromWire(value as SelfSealedWire);
  }

  async putOrganization(sealed: SelfSealed): Promise<void> {
    await this.kv.write(this.organizationPath(), selfSealedToWire(sealed));
  }
}
