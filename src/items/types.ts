// Mirrors internal/items/types.go. One Content union with concrete typed
// shapes; each carries an optional customFields array. JSON tags match the Go
// structs exactly so encoded content round-trips with the desktop app.

export type ItemType = 'login' | 'card' | 'note' | 'identity' | 'password' | 'custom';

export type FieldType = 'text' | 'hidden' | 'totp' | 'url';

export interface Field {
  type: FieldType;
  label: string;
  value: string;
}

export interface Login {
  title: string;
  username: string;
  password: string;
  urls?: string[];
  totp?: string;
  note?: string;
  custom_fields?: Field[];
}

export interface Card {
  title: string;
  cardholder: string;
  number: string;
  expiration_date: string;
  cvv?: string;
  pin?: string;
  note?: string;
  custom_fields?: Field[];
}

export interface Note {
  title: string;
  body: string;
  custom_fields?: Field[];
}

export interface Identity {
  title: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  address?: string;
  company?: string;
  job_title?: string;
  note?: string;
  custom_fields?: Field[];
}

export interface Password {
  title: string;
  password: string;
  note?: string;
  custom_fields?: Field[];
}

export interface Custom {
  title: string;
  custom_fields?: Field[];
}

/** A decrypted item payload tagged with its concrete type. */
export type Content =
  | { kind: 'login'; data: Login }
  | { kind: 'card'; data: Card }
  | { kind: 'note'; data: Note }
  | { kind: 'identity'; data: Identity }
  | { kind: 'password'; data: Password }
  | { kind: 'custom'; data: Custom };
