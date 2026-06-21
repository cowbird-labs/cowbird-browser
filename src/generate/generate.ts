// Cryptographically strong password and passphrase generation, a port of
// internal/generate/generate.go. Randomness comes from ./rand (CSPRNG, unbiased).
// Pure and UI-independent so the popup (and any future surface) can share it.

import { randIndex, randPick, shuffle } from './rand';
import { words, WORDLIST_SIZE } from './wordlist';

const lowerChars = 'abcdefghijklmnopqrstuvwxyz';
const upperChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const digitChars = '0123456789';
const symbolChars = '!@#$%^&*()-_=+[]{}<>?/';

// ambiguousChars are visually confusable characters dropped when
// PasswordOpts.excludeAmbiguous is set.
const ambiguousChars = 'il1IoO0|';

export interface PasswordOpts {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
}

export interface PassphraseOpts {
  words: number;
  separator: string;
  capitalize: boolean;
  includeNumber: boolean;
}

function stripChars(s: string, remove: string): string {
  let out = '';
  for (const ch of s) if (!remove.includes(ch)) out += ch;
  return out;
}

// passwordClasses returns the enabled character classes, each already stripped
// of ambiguous characters when requested. Empty classes are omitted.
function passwordClasses(o: PasswordOpts): string[] {
  const cs: string[] = [];
  for (const [on, chars] of [
    [o.lower, lowerChars],
    [o.upper, upperChars],
    [o.digits, digitChars],
    [o.symbols, symbolChars],
  ] as const) {
    if (!on) continue;
    const s = o.excludeAmbiguous ? stripChars(chars, ambiguousChars) : chars;
    if (s) cs.push(s);
  }
  return cs;
}

/**
 * password returns a random password honouring opts. It guarantees at least one
 * character from each enabled class, fills the remaining length from the combined
 * pool, then shuffles so the guaranteed characters are not positionally fixed. It
 * throws if no class is enabled or the length cannot fit one char per class.
 */
export function password(opts: PasswordOpts): string {
  const classes = passwordClasses(opts);
  if (classes.length === 0) {
    throw new Error('password: at least one character class must be enabled');
  }
  if (opts.length < classes.length) {
    throw new Error(
      `password: length ${opts.length} is too short for ${classes.length} character classes`,
    );
  }

  const poolChars = [...classes.join('')];
  const out: string[] = [];
  for (const cls of classes) out.push(randPick([...cls]));
  while (out.length < opts.length) out.push(randPick(poolChars));

  shuffle(out);
  return out.join('');
}

/**
 * passphrase returns a separator-joined sequence of words from the EFF long
 * wordlist. With capitalize each word is title-cased; with includeNumber a single
 * random digit is appended to one randomly chosen word. Throws if words <= 0.
 */
export function passphrase(opts: PassphraseOpts): string {
  if (opts.words <= 0) {
    throw new Error(`passphrase: word count must be positive, got ${opts.words}`);
  }

  const chosen: string[] = [];
  for (let i = 0; i < opts.words; i++) {
    let w = randPick(words);
    if (opts.capitalize) w = capitalize(w);
    chosen.push(w);
  }

  if (opts.includeNumber) {
    const d = randIndex(10);
    const idx = randIndex(chosen.length);
    chosen[idx] = chosen[idx]! + String(d);
  }

  return chosen.join(opts.separator);
}

/**
 * passwordEntropy reports the password's entropy in bits, length × log2(poolSize)
 * over the combined enabled-class pool. Returns 0 when no class is enabled.
 */
export function passwordEntropy(o: PasswordOpts): number {
  let pool = 0;
  for (const c of passwordClasses(o)) pool += c.length;
  if (pool === 0 || o.length === 0) return 0;
  return o.length * Math.log2(pool);
}

/**
 * passphraseEntropy reports the passphrase's entropy in bits from the word
 * choices alone (words × log2(wordlistSize)) — a conservative figure that ignores
 * the extra bits from capitalization and the optional digit.
 */
export function passphraseEntropy(o: PassphraseOpts): number {
  if (o.words <= 0) return 0;
  return o.words * Math.log2(WORDLIST_SIZE);
}

// capitalize upper-cases the first letter of w (ASCII; the wordlist is ASCII).
function capitalize(w: string): string {
  if (!w) return w;
  return w[0]!.toUpperCase() + w.slice(1);
}
