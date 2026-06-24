// Mirrors internal/organization/organization.go.
//
// Models a user's private, per-item organization overlay: favorites and label
// assignments that apply to items the user owns as well as items shared with
// them. It is UI- and Vault-independent so callers (core/organization.ts) handle
// encryption (crypto.sealToSelf) and persistence (the users/<entityID>/organization
// Vault path).
//
// Organization is keyed by item identifier: the itemID for owned items and the
// shareID for items shared with the user. It is never stored in item content and
// never travels in a shared envelope, so toggling a favorite or label never
// rewrites or re-distributes an item and stays private to the user.

/** SCHEMA_VERSION is the current Organization schema version. */
export const SCHEMA_VERSION = 1;

/** Label is a user-defined tag with an opaque ID, a display name, and an optional
 * color (hex, e.g. "#3b82f6"). */
export interface Label {
  id: string;
  name: string;
  color?: string;
}

/** ItemMeta is one item's organization: a favorite flag and assigned label IDs.
 * Mirrors the Go struct's `favorite,omitempty` / `labels,omitempty` JSON tags. */
export interface ItemMeta {
  favorite?: boolean;
  labels?: string[];
}

/** OrganizationJSON is the at-rest JSON shape (matches Go's struct tags). */
export interface OrganizationJSON {
  version: number;
  labels?: Label[];
  items?: Record<string, ItemMeta>;
}

function metaIsEmpty(m: ItemMeta): boolean {
  return !m.favorite && (m.labels?.length ?? 0) === 0;
}

/**
 * Organization is a user's complete organization record: label definitions plus
 * per-item metadata. Construct with `newOrganization()` or `parseOrganization()`;
 * all mutators operate in memory and the caller persists.
 */
export class Organization {
  version: number;
  labels: Label[];
  items: Map<string, ItemMeta>;

  constructor(version = SCHEMA_VERSION, labels: Label[] = [], items?: Map<string, ItemMeta>) {
    this.version = version;
    this.labels = labels;
    this.items = items ?? new Map();
  }

  isFavorite(id: string): boolean {
    return this.items.get(id)?.favorite ?? false;
  }

  /** toggleFavorite flips the favorite flag for an item and returns the new state. */
  toggleFavorite(id: string): boolean {
    const m = { ...(this.items.get(id) ?? {}) };
    m.favorite = !m.favorite;
    this.set(id, m);
    return m.favorite;
  }

  /** setFavorite sets the favorite flag for an item explicitly. */
  setFavorite(id: string, fav: boolean): void {
    const m = { ...(this.items.get(id) ?? {}) };
    m.favorite = fav;
    this.set(id, m);
  }

  /** labelsOf returns the label IDs assigned to an item (a copy). */
  labelsOf(id: string): string[] {
    return [...(this.items.get(id)?.labels ?? [])];
  }

  /** assignLabel adds a label to an item. No-op if already assigned or the
   * labelID is not a defined label. */
  assignLabel(id: string, labelID: string): void {
    if (!this.hasLabel(labelID)) return;
    const m = { ...(this.items.get(id) ?? {}) };
    const labels = [...(m.labels ?? [])];
    if (labels.includes(labelID)) return;
    labels.push(labelID);
    m.labels = labels;
    this.set(id, m);
  }

  /** unassignLabel removes a label from an item. */
  unassignLabel(id: string, labelID: string): void {
    const existing = this.items.get(id);
    if (!existing) return;
    const m = { ...existing };
    const labels = (m.labels ?? []).filter((l) => l !== labelID);
    m.labels = labels.length > 0 ? labels : undefined;
    this.set(id, m);
  }

  /** addLabel defines a new label with a generated ID. Name must be non-empty. */
  addLabel(name: string, color: string): Label {
    if (name === '') throw new Error('label name is required');
    const l: Label = { id: newID(), name };
    if (color) l.color = color;
    this.labels.push(l);
    return l;
  }

  /** renameLabel changes a label's display name. Returns whether it existed. */
  renameLabel(labelID: string, name: string): boolean {
    const l = this.labels.find((x) => x.id === labelID);
    if (!l) return false;
    l.name = name;
    return true;
  }

  /** recolorLabel changes a label's color. Returns whether it existed. */
  recolorLabel(labelID: string, color: string): boolean {
    const l = this.labels.find((x) => x.id === labelID);
    if (!l) return false;
    if (color) l.color = color;
    else delete l.color;
    return true;
  }

  /** deleteLabel removes a label definition and strips it from every item. */
  deleteLabel(labelID: string): void {
    this.labels = this.labels.filter((l) => l.id !== labelID);
    for (const id of [...this.items.keys()]) {
      this.unassignLabel(id, labelID);
    }
  }

  /** label returns the named label definition, or undefined if it does not exist. */
  label(labelID: string): Label | undefined {
    return this.labels.find((l) => l.id === labelID);
  }

  /** forget drops an item's metadata entirely (call when an item is deleted). */
  forget(id: string): void {
    this.items.delete(id);
  }

  /**
   * prune drops metadata for any item id not present in liveIDs, cleaning up after
   * deleted items and dead shares. Returns whether anything was removed.
   */
  prune(liveIDs: Set<string>): boolean {
    let changed = false;
    for (const id of [...this.items.keys()]) {
      if (!liveIDs.has(id)) {
        this.items.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  /** set stores an item's metadata, dropping the entry entirely when empty so the
   * map never accumulates blank records. */
  private set(id: string, m: ItemMeta): void {
    if (metaIsEmpty(m)) {
      this.items.delete(id);
      return;
    }
    this.items.set(id, m);
  }

  private hasLabel(labelID: string): boolean {
    return this.label(labelID) !== undefined;
  }

  /** json serializes the record to its at-rest JSON shape (matches Go's tags:
   * empty labels/items and empty meta fields are omitted). */
  json(): OrganizationJSON {
    const out: OrganizationJSON = { version: this.version };
    if (this.labels.length > 0) out.labels = this.labels;
    if (this.items.size > 0) {
      const items: Record<string, ItemMeta> = {};
      for (const [id, m] of this.items) {
        const meta: ItemMeta = {};
        if (m.favorite) meta.favorite = true;
        if (m.labels && m.labels.length > 0) meta.labels = m.labels;
        items[id] = meta;
      }
      out.items = items;
    }
    return out;
  }
}

/** newOrganization returns an empty organization record at the current schema version. */
export function newOrganization(): Organization {
  return new Organization();
}

/**
 * parseOrganization decodes a JSON record. Empty/absent input yields a fresh
 * record, so a missing Vault entry decodes cleanly to an empty organization.
 */
export function parseOrganization(bytes: Uint8Array | null): Organization {
  if (!bytes || bytes.length === 0) return newOrganization();
  const o = JSON.parse(new TextDecoder().decode(bytes)) as OrganizationJSON;
  const version = o.version && o.version !== 0 ? o.version : SCHEMA_VERSION;
  const items = new Map<string, ItemMeta>();
  for (const [id, m] of Object.entries(o.items ?? {})) {
    items.set(id, { favorite: m.favorite || undefined, labels: m.labels });
  }
  return new Organization(version, o.labels ?? [], items);
}

/** newID returns a random UUID v4 (matches Go's crypto/rand UUID format). */
function newID(): string {
  return crypto.randomUUID();
}
