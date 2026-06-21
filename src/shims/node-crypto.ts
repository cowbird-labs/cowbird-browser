// totp-generator references `require('node:crypto').webcrypto` as a Node fallback
// for environments lacking globalThis.crypto. Every extension context (popup,
// service worker, content script) always has globalThis.crypto, so that branch
// never runs at runtime. Aliasing `node:crypto` to this browser-safe stub (see
// wxt.config.ts) stops the bundler from externalizing a Node builtin — which
// emits a "module externalized for browser compatibility" warning — while keeping
// the fallback shape intact in case it is ever reached.
export const webcrypto: Crypto = globalThis.crypto;
export default { webcrypto: globalThis.crypto };
