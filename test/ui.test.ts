import { describe, expect, it } from 'vitest';
import { addressMissingPort, addressSchemeIssue } from '../src/popup/util';
import { normalizeAddress } from '../src/core/config';

describe('addressMissingPort', () => {
  it('warns when a parseable address has no port', () => {
    expect(addressMissingPort('https://vault.example.com')).toBe(true);
    expect(addressMissingPort('vault.example.com')).toBe(true); // scheme assumed
    expect(addressMissingPort('http://10.0.0.5')).toBe(true);
  });

  it('does not warn when a port is present (including an explicit :443)', () => {
    expect(addressMissingPort('https://vault.example.com:8200')).toBe(false);
    expect(addressMissingPort('https://vault.example.com:443')).toBe(false);
    expect(addressMissingPort('vault.example.com:8200')).toBe(false);
  });

  it('does not warn for empty or unparseable input', () => {
    expect(addressMissingPort('')).toBe(false);
    expect(addressMissingPort('   ')).toBe(false);
    expect(addressMissingPort('http://')).toBe(false);
  });
});

describe('addressSchemeIssue', () => {
  it('flags plain http as insecure', () => {
    expect(addressSchemeIssue('http://vault.example.com:8200')).toBe('insecure');
    expect(addressSchemeIssue('HTTP://vault.example.com')).toBe('insecure');
  });

  it('flags a missing scheme', () => {
    expect(addressSchemeIssue('vault.example.com:8200')).toBe('no-scheme');
    expect(addressSchemeIssue('vault.example.com')).toBe('no-scheme');
  });

  it('is null for https and for empty input', () => {
    expect(addressSchemeIssue('https://vault.example.com:8200')).toBe(null);
    expect(addressSchemeIssue('')).toBe(null);
    expect(addressSchemeIssue('   ')).toBe(null);
  });
});

describe('normalizeAddress', () => {
  it('defaults a missing scheme to https', () => {
    expect(normalizeAddress('vault.example.com:8200')).toBe('https://vault.example.com:8200');
  });

  it('leaves an explicit scheme untouched (including http)', () => {
    expect(normalizeAddress('https://vault.example.com:8200')).toBe('https://vault.example.com:8200');
    expect(normalizeAddress('http://vault.example.com:8200')).toBe('http://vault.example.com:8200');
  });

  it('trims whitespace and trailing slashes', () => {
    expect(normalizeAddress('  https://vault.example.com:8200/  ')).toBe(
      'https://vault.example.com:8200',
    );
    expect(normalizeAddress('')).toBe('');
  });
});
