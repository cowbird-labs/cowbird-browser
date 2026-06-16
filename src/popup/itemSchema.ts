import type { ItemType } from '../items/types';

// UI metadata for editing/displaying each item type. `title` is implicit (every
// type has one, rendered first); `urls` (login) and `custom_fields` (all types)
// are handled specially by the editor.

export const ITEM_TYPES: { type: ItemType; label: string }[] = [
  { type: 'login', label: 'Login' },
  { type: 'password', label: 'Password' },
  { type: 'card', label: 'Card' },
  { type: 'identity', label: 'Identity' },
  { type: 'note', label: 'Secure Note' },
  { type: 'custom', label: 'Custom' },
];

export interface FieldDef {
  key: string;
  label: string;
  /** Label to show in the editor when it differs from the display label. */
  editLabel?: string;
  secret?: boolean;
  multiline?: boolean;
  /** Detail view renders the live one-time code instead of the stored secret. */
  totp?: boolean;
}

export const TYPE_FIELDS: Record<ItemType, FieldDef[]> = {
  login: [
    { key: 'username', label: 'Username' },
    { key: 'password', label: 'Password', secret: true },
    { key: 'totp', label: 'One-time code', editLabel: 'TOTP secret', secret: true, totp: true },
    { key: 'note', label: 'Note', multiline: true },
  ],
  password: [
    { key: 'password', label: 'Password', secret: true },
    { key: 'note', label: 'Note', multiline: true },
  ],
  card: [
    { key: 'cardholder', label: 'Cardholder' },
    { key: 'number', label: 'Number' },
    { key: 'expiration_date', label: 'Expiration' },
    { key: 'cvv', label: 'CVV', secret: true },
    { key: 'pin', label: 'PIN', secret: true },
    { key: 'note', label: 'Note', multiline: true },
  ],
  identity: [
    { key: 'first_name', label: 'First name' },
    { key: 'last_name', label: 'Last name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'address', label: 'Address', multiline: true },
    { key: 'company', label: 'Company' },
    { key: 'job_title', label: 'Job title' },
    { key: 'note', label: 'Note', multiline: true },
  ],
  note: [{ key: 'body', label: 'Body', multiline: true }],
  custom: [],
};

export function typeLabel(type: ItemType): string {
  return ITEM_TYPES.find((t) => t.type === type)?.label ?? type;
}
