/** errorMessage extracts a human-readable string from an unknown thrown value. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** copyText writes text to the clipboard, swallowing failures. */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard may be unavailable; nothing else to do.
  }
}
