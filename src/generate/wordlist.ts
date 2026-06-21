import raw from './eff_large_wordlist.txt?raw';

// The EFF long wordlist (7776 words), embedded for passphrase generation.
// Mirrors internal/generate/wordlist.go. Each word contributes
// log2(7776) ≈ 12.925 bits of entropy to a passphrase.

export const WORDLIST_SIZE = 7776;

// The source file is tab-separated "<dice>\t<word>" lines (e.g. "11111\tabacus");
// only the word after the tab is retained.
function parseWordlist(text: string): string[] {
  const out: string[] = [];
  for (const rawLine of text.trim().split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const i = line.indexOf('\t');
    out.push(i >= 0 ? line.slice(i + 1) : line);
  }
  return out;
}

export const words = parseWordlist(raw);
