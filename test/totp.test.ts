import { describe, expect, it } from 'vitest';
import { totpCode } from '../src/items/totp';

const SECRET = 'JBSWY3DPEHPK3PXP';

describe('totp', () => {
  it('generates a 6-digit code from a bare base32 secret', async () => {
    const { code, remaining } = await totpCode(SECRET);
    expect(code).toMatch(/^\d{6}$/);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(30);
  });

  it('strips internal spaces from a grouped secret', async () => {
    const { code } = await totpCode('JBSW Y3DP EHPK 3PXP');
    expect(code).toMatch(/^\d{6}$/);
  });

  it('honours digits and period from an otpauth:// URI', async () => {
    const uri =
      `otpauth://totp/Example:alice@example.com?issuer=Example&secret=${SECRET}` +
      '&algorithm=SHA1&digits=8&period=60';
    const { code, remaining } = await totpCode(uri);
    expect(code).toMatch(/^\d{8}$/);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(60);
  });

  it('throws on an empty secret', async () => {
    await expect(totpCode('   ')).rejects.toThrow(/empty TOTP secret/);
  });

  it('throws on an otpauth URI without a secret', async () => {
    await expect(totpCode('otpauth://totp/x?digits=6')).rejects.toThrow(/missing secret/);
  });
});
