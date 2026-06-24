// Advisory password-strength scoring, a port of internal/ui/strength.go. The
// scores and labels are display-only — they gate nothing; real protection comes
// from the Argon2id KDF. Kept pure and UI-independent so any surface can share it.

export interface Strength {
  // score is a 0..1 bar value (bits/80, capped at 1).
  score: number;
  // label is a coarse human band ('Very weak'..'Strong'), or '' for empty input.
  label: string;
  // bits is the underlying entropy estimate.
  bits: number;
}

/**
 * passwordStrength estimates the strength of an arbitrary typed password from a
 * charset-entropy figure with a repetition penalty, matching the desktop app:
 * the effective length averages the real length with the unique-rune count, so
 * "aaaaaaaa" scores low. Returns a zero score and empty label for "".
 */
export function passwordStrength(pw: string): Strength {
  if (pw === '') return { score: 0, label: '', bits: 0 };

  let lower = false,
    upper = false,
    digit = false,
    other = false;
  const unique = new Set<string>();
  let n = 0;
  for (const r of pw) {
    n++;
    unique.add(r);
    if (r >= 'a' && r <= 'z') lower = true;
    else if (r >= 'A' && r <= 'Z') upper = true;
    else if (r >= '0' && r <= '9') digit = true;
    else other = true;
  }

  let charset = 0;
  if (lower) charset += 26;
  if (upper) charset += 26;
  if (digit) charset += 10;
  if (other) charset += 33;

  // Repeated characters carry less entropy than length suggests; average the
  // length with the unique-character count so "aaaaaaaa" scores low.
  const effective = (n + unique.size) / 2;
  const bits = effective * Math.log2(charset);

  return strengthFromBits(bits);
}

/**
 * strengthFromBits maps an entropy estimate (bits) to a 0..1 bar score and a
 * coarse label — the shared scale used by both the typed-password heuristic and
 * the generator's entropy-accurate readout.
 */
export function strengthFromBits(bits: number): Strength {
  let label = 'Very weak';
  if (bits >= 80) label = 'Strong';
  else if (bits >= 60) label = 'Good';
  else if (bits >= 36) label = 'Fair';
  else if (bits >= 28) label = 'Weak';
  return { score: Math.min(bits / 80, 1), label, bits };
}
