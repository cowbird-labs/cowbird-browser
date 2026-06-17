import { describe, expect, it } from 'vitest';
import { classifySubmission, hostMatches } from '../src/autofill/match';
import type { HostLogin } from '../src/autofill/match';

const login = (over: Partial<HostLogin> = {}): HostLogin => ({
  id: 'i1',
  title: 'Example',
  username: 'alice@example.com',
  password: 'pw1',
  ...over,
});

describe('classifySubmission', () => {
  it('saves when the host has no logins', () => {
    expect(classifySubmission([], 'alice@example.com', 'pw1')).toEqual({ kind: 'save' });
  });

  it('does nothing when an identical login already exists', () => {
    expect(classifySubmission([login()], 'alice@example.com', 'pw1')).toEqual({ kind: 'none' });
  });

  it('updates when the same username has a different password', () => {
    expect(classifySubmission([login()], 'alice@example.com', 'newpw')).toEqual({
      kind: 'update',
      id: 'i1',
      title: 'Example',
    });
  });

  it('matches usernames case-insensitively and trimmed', () => {
    expect(classifySubmission([login()], '  ALICE@example.com  ', 'pw1')).toEqual({ kind: 'none' });
  });

  it('saves a second account on the same site', () => {
    expect(classifySubmission([login()], 'bob@example.com', 'pw2')).toEqual({ kind: 'save' });
  });

  it('updates an empty-username login when the submission has no username', () => {
    const only = login({ username: '', title: 'Site' });
    expect(classifySubmission([only], '', 'changed')).toEqual({
      kind: 'update',
      id: 'i1',
      title: 'Site',
    });
    // ...and reports `none` when that empty-username login's password is unchanged.
    expect(classifySubmission([only], '', 'pw1')).toEqual({ kind: 'none' });
  });

  it('saves a named-username submission even when an empty-username login exists', () => {
    const a = login({ id: 'a', username: '' });
    const b = login({ id: 'b', username: 'bob' });
    expect(classifySubmission([a, b], 'carol', 'pw')).toEqual({ kind: 'save' });
  });
});

describe('hostMatches', () => {
  it('matches subdomains in either direction', () => {
    expect(hostMatches('https://example.com', 'login.example.com')).toBe(true);
    expect(hostMatches('login.example.com', 'example.com')).toBe(true);
    expect(hostMatches('https://example.com', 'evil.com')).toBe(false);
  });
});
