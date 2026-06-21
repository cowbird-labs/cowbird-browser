import type { Content, Field, FieldType } from '../items/types';

// Shared helpers for the third-party format adapters, a port of
// internal/transfer/mapping.go. They read fields off the Content union and build
// cowbird custom fields, so a value with no native target is carried rather than
// dropped.

/** titleOf returns an item's title regardless of concrete type. */
export function titleOf(c: Content): string {
  return c.data.title;
}

/** customFieldsOf returns a copy of an item's custom fields (never the original). */
export function customFieldsOf(c: Content): Field[] {
  return [...(c.data.custom_fields ?? [])];
}

/** noteOf returns the free-text note/body of an item, or "" if it has none. */
export function noteOf(c: Content): string {
  switch (c.kind) {
    case 'login':
    case 'card':
    case 'identity':
    case 'password':
      return c.data.note ?? '';
    case 'note':
      return c.data.body ?? '';
    default:
      return '';
  }
}

/**
 * field builds a cowbird custom field, defaulting empty labels so a value is
 * never silently dropped for want of a label.
 */
export function field(label: string, value: string, t: FieldType): Field {
  return { type: t, label: label || 'Field', value };
}

/**
 * appendIfValue returns fields with a new custom field appended only when value
 * is non-empty, so empty source fields do not litter the imported item.
 */
export function appendIfValue(fields: Field[], label: string, value: string, t: FieldType): Field[] {
  if (!value) return fields;
  return [...fields, field(label, value, t)];
}

/**
 * splitExpiration parses a cowbird expiration ("MM/YY" or "MM/YYYY") into a
 * numeric month and a four-digit year. Unparseable input yields ("", "").
 */
export function splitExpiration(s: string): { month: string; year: string } {
  s = s.trim();
  const parts = s.split('/');
  if (parts.length !== 2) return { month: '', year: '' };
  let month = parts[0]!;
  if (month.startsWith('0')) month = month.slice(1);
  month = month.trim();
  if (month === '') month = '0';
  let year = parts[1]!.trim();
  if (year.length === 2) year = '20' + year;
  return { month, year };
}

/**
 * joinExpiration renders a "MM/YY" expiration from a month and a (2- or 4-digit)
 * year. Either part may be empty.
 */
export function joinExpiration(month: string, year: string): string {
  month = month.trim();
  year = year.trim();
  if (month === '' && year === '') return '';
  if (month.length === 1) month = '0' + month;
  if (year.length === 4) year = year.slice(2);
  return `${month}/${year}`;
}

/** errMessage normalises an unknown thrown value to a string. */
export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
