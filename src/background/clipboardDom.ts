// Writes text to the clipboard from a DOM-bearing extension context — Firefox's
// persistent background page, or a Chrome offscreen document. The async Clipboard
// API (navigator.clipboard) requires a focused document, which these unfocused
// contexts lack; intercepting the synchronous `copy` event instead lets us set
// arbitrary data without focus or a user gesture (the clipboardWrite permission
// authorizes the programmatic copy). Passing an empty string clears the clipboard.
//
// Used by src/background/security.ts (Firefox path) and the Chrome offscreen
// document (entrypoints/offscreen). Must only be called where `document` exists.

export function writeClipboardViaDom(text: string): void {
  const onCopy = (e: ClipboardEvent) => {
    e.preventDefault();
    e.clipboardData?.setData('text/plain', text);
  };
  // execCommand('copy') only fires the copy event when there is a selection, so
  // stage a throwaway textarea with a non-empty value purely to satisfy that —
  // the onCopy handler overrides the actual payload (e.g. '' to clear).
  const ta = document.createElement('textarea');
  ta.value = ' ';
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  document.addEventListener('copy', onCopy);
  try {
    document.execCommand('copy');
  } finally {
    document.removeEventListener('copy', onCopy);
    ta.remove();
  }
}

/** clearClipboardViaDom wipes the clipboard (writes an empty string). */
export function clearClipboardViaDom(): void {
  writeClipboardViaDom('');
}
