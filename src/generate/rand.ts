// Unbiased random selection from the platform CSPRNG (crypto.getRandomValues),
// mirroring internal/generate/rand.go. Rejection sampling against the largest
// multiple of n that fits in a uint64 removes modulo bias. Math.random is never
// used.

/**
 * randIndex returns a uniformly distributed integer in [0, n). It draws 8 random
 * bytes as a big-endian uint64 and rejects values in the top `2^64 mod n` band,
 * re-drawing until one falls in range, so the result carries no modulo bias.
 */
export function randIndex(n: number): number {
  if (n <= 0) throw new Error(`randIndex: n must be positive, got ${n}`);
  const un = BigInt(n);
  const maxUint = (1n << 64n) - 1n;
  const limit = maxUint - (maxUint % un);
  const buf = new Uint8Array(8);
  for (;;) {
    crypto.getRandomValues(buf);
    let v = 0n;
    for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(buf[i]!);
    if (v < limit) return Number(v % un);
  }
}

/** randPick returns a uniformly random element of a non-empty array. */
export function randPick<T>(s: readonly T[]): T {
  const v = s[randIndex(s.length)];
  if (v === undefined) throw new Error('randPick: empty slice');
  return v;
}

/**
 * shuffle performs an in-place Fisher–Yates shuffle using the CSPRNG, so the
 * positions of guaranteed characters in a generated password are not fixed.
 */
export function shuffle<T>(s: T[]): void {
  for (let i = s.length - 1; i > 0; i--) {
    const j = randIndex(i + 1);
    const tmp = s[i]!;
    s[i] = s[j]!;
    s[j] = tmp;
  }
}
