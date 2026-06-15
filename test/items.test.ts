import { describe, expect, it } from 'vitest';
import { encode, decode } from '../src/items/codec';
import type { Content } from '../src/items/types';

describe('items codec', () => {
  it('round-trips a login with custom fields', () => {
    const login: Content = {
      kind: 'login',
      data: {
        title: 'GitHub',
        username: 'breaker1',
        password: 's3cr3t',
        urls: ['https://github.com'],
        custom_fields: [{ type: 'totp', label: '2FA', value: 'OTPSEED' }],
      },
    };
    const restored = decode(encode(login));
    expect(restored).toEqual(login);
  });

  it('emits a {type, data} envelope matching the Go wire format', () => {
    const note: Content = { kind: 'note', data: { title: 'n', body: 'b' } };
    const json = JSON.parse(new TextDecoder().decode(encode(note)));
    expect(json).toEqual({ type: 'note', data: { title: 'n', body: 'b' } });
  });

  it('rejects an unknown item type', () => {
    const bad = new TextEncoder().encode('{"type":"bogus","data":{}}');
    expect(() => decode(bad)).toThrow('unknown item type');
  });
});
