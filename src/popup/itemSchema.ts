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
  /** Icon name (see popup/components/Icon) shown beside the field in the detail view. */
  icon?: string;
  /** Render the value in a monospace font (codes, numbers, secrets). */
  mono?: boolean;
}

export const TYPE_FIELDS: Record<ItemType, FieldDef[]> = {
  login: [
    { key: 'username', label: 'Username', icon: 'user' },
    { key: 'password', label: 'Password', secret: true, mono: true, icon: 'key' },
    {
      key: 'totp',
      label: '2FA token (TOTP)',
      editLabel: 'TOTP secret',
      secret: true,
      totp: true,
      icon: 'lock',
    },
    { key: 'note', label: 'Note', multiline: true, icon: 'note' },
  ],
  password: [
    { key: 'password', label: 'Password', secret: true, mono: true, icon: 'key' },
    { key: 'note', label: 'Note', multiline: true, icon: 'note' },
  ],
  card: [
    { key: 'cardholder', label: 'Cardholder', icon: 'user' },
    { key: 'number', label: 'Number', mono: true, icon: 'card' },
    { key: 'expiration_date', label: 'Expiration', icon: 'calendar' },
    { key: 'cvv', label: 'CVV', secret: true, mono: true, icon: 'lock' },
    { key: 'pin', label: 'PIN', secret: true, mono: true, icon: 'lock' },
    { key: 'note', label: 'Note', multiline: true, icon: 'note' },
  ],
  identity: [
    { key: 'first_name', label: 'First name', icon: 'user' },
    { key: 'last_name', label: 'Last name', icon: 'user' },
    { key: 'email', label: 'Email', icon: 'mail' },
    { key: 'phone', label: 'Phone', icon: 'phone' },
    { key: 'address', label: 'Address', multiline: true, icon: 'pin' },
    { key: 'company', label: 'Company', icon: 'briefcase' },
    { key: 'job_title', label: 'Job title', icon: 'briefcase' },
    { key: 'note', label: 'Note', multiline: true, icon: 'note' },
  ],
  note: [{ key: 'body', label: 'Body', multiline: true, icon: 'note' }],
  custom: [],
};

export function typeLabel(type: ItemType): string {
  return ITEM_TYPES.find((t) => t.type === type)?.label ?? type;
}
