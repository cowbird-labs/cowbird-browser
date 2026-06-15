import { sodium } from './sodium';

export const ITEM_KEY_LEN = 32;

/** newItemKey generates a random 32-byte symmetric item key. */
export function newItemKey(): Uint8Array {
  return sodium.randombytes_buf(ITEM_KEY_LEN);
}
