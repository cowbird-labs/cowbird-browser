import { userpass } from './userpass';
import { token } from './token';
import { approle } from './approle';
import type { AuthMethod } from './types';

export type { AuthMethod, AuthField, AuthResult } from './types';
export { userpass, token, approle };

/** All supported auth methods, in UI display order. */
export const methods: AuthMethod[] = [userpass, token, approle];

/** byId returns the method with the given stable id, or undefined. */
export function methodById(id: string): AuthMethod | undefined {
  return methods.find((m) => m.id === id);
}
