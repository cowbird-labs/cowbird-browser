import _sodium from 'libsodium-wrappers-sumo';

let ready = false;

/**
 * initCrypto must be awaited once before any crypto function is used.
 * libsodium loads a WASM module asynchronously; sodium calls throw until ready.
 */
export async function initCrypto(): Promise<void> {
  if (ready) return;
  await _sodium.ready;
  ready = true;
}

/** The initialized libsodium instance. Only valid after initCrypto() resolves. */
export const sodium = _sodium;
