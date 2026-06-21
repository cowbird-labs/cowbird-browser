import { describe, expect, it } from 'vitest';
import {
  password,
  passphrase,
  passwordEntropy,
  passphraseEntropy,
  type PasswordOpts,
  type PassphraseOpts,
} from '../src/generate';

const fullPw: PasswordOpts = {
  length: 24,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: false,
};

describe('password generator', () => {
  it('honours the requested length', () => {
    for (let i = 0; i < 20; i++) {
      expect(password({ ...fullPw, length: 16 })).toHaveLength(16);
    }
  });

  it('includes at least one character from each enabled class', () => {
    for (let i = 0; i < 50; i++) {
      const pw = password(fullPw);
      expect(/[a-z]/.test(pw)).toBe(true);
      expect(/[A-Z]/.test(pw)).toBe(true);
      expect(/[0-9]/.test(pw)).toBe(true);
      expect(/[^a-zA-Z0-9]/.test(pw)).toBe(true);
    }
  });

  it('only uses enabled classes', () => {
    const pw = password({ ...fullPw, length: 40, upper: false, symbols: false });
    expect(/^[a-z0-9]+$/.test(pw)).toBe(true);
  });

  it('excludes ambiguous characters when asked', () => {
    const pw = password({ ...fullPw, length: 200, excludeAmbiguous: true });
    expect(/[il1IoO0|]/.test(pw)).toBe(false);
  });

  it('throws when no class is enabled', () => {
    expect(() =>
      password({ length: 12, lower: false, upper: false, digits: false, symbols: false, excludeAmbiguous: false }),
    ).toThrow(/at least one character class/);
  });

  it('throws when length cannot fit one char per class', () => {
    expect(() => password({ ...fullPw, length: 3 })).toThrow(/too short/);
  });
});

const phrase: PassphraseOpts = { words: 5, separator: '-', capitalize: false, includeNumber: false };

describe('passphrase generator', () => {
  it('produces the requested number of words', () => {
    const out = passphrase(phrase);
    expect(out.split('-')).toHaveLength(5);
  });

  it('uses the chosen separator', () => {
    const out = passphrase({ ...phrase, separator: '.' });
    expect(out.split('.')).toHaveLength(5);
    expect(out).not.toContain('-');
  });

  it('capitalises each word', () => {
    const out = passphrase({ ...phrase, capitalize: true });
    for (const w of out.split('-')) expect(w[0]).toBe(w[0]!.toUpperCase());
  });

  it('includes a digit when asked', () => {
    let sawDigit = false;
    for (let i = 0; i < 20; i++) {
      if (/[0-9]/.test(passphrase({ ...phrase, includeNumber: true }))) sawDigit = true;
    }
    expect(sawDigit).toBe(true);
  });

  it('throws on a non-positive word count', () => {
    expect(() => passphrase({ ...phrase, words: 0 })).toThrow(/positive/);
  });
});

describe('entropy', () => {
  it('computes password entropy as length × log2(pool)', () => {
    // lower+upper+digits = 62 chars, length 20.
    const bits = passwordEntropy({ ...fullPw, symbols: false, length: 20 });
    expect(bits).toBeCloseTo(20 * Math.log2(62), 6);
  });

  it('computes passphrase entropy as words × log2(7776)', () => {
    expect(passphraseEntropy(phrase)).toBeCloseTo(5 * Math.log2(7776), 6);
  });
});
