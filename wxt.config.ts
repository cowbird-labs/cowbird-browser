import { defineConfig } from 'wxt';
import { createRequire } from 'node:module';

// wxt builds the extension for both Chrome and Firefox MV3 from one source,
// handling the background (service worker vs event page) and manifest
// differences automatically. Entry points live in ./entrypoints; all app logic
// stays in ./src and is imported by thin entrypoint wrappers.

const require = createRequire(import.meta.url);
// Alias the broken ESM build of libsodium-wrappers-sumo to its CJS entry (the
// same fix used in vitest.config.ts); Vite bundles the CJS with embedded WASM.
const sodiumCjs = require.resolve('libsodium-wrappers-sumo');

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // AMO data-collection consent is irrelevant for locally loaded dev builds.
  suppressWarnings: { firefoxDataCollection: true },
  manifest: {
    name: 'Cowbird',
    description: 'End-to-end encrypted password manager backed by your own HashiCorp Vault.',
    // storage: config + in-memory session; scripting/activeTab: autofill (later);
    // clipboardWrite: copy secrets. Broad host access: the Vault address is
    // user-configured and autofill runs on arbitrary sites.
    permissions: ['storage', 'activeTab', 'scripting', 'clipboardWrite'],
    host_permissions: ['<all_urls>'],
    // 'wasm-unsafe-eval' lets libsodium and hash-wasm instantiate their WASM.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    // Toolbar button icon (top-level `icons` is auto-detected from public/icon/*;
    // setting default_icon makes the action button render the branded icon too —
    // wxt maps `action` to `browser_action` for the Firefox MV2 build).
    action: {
      default_title: 'Cowbird',
      default_icon: {
        '16': 'icon/16.png',
        '32': 'icon/32.png',
        '48': 'icon/48.png',
        '128': 'icon/128.png',
      },
    },
    // Firefox requires an explicit add-on id and storage.session lands in FF 115.
    browser_specific_settings: {
      gecko: { id: 'cowbird@avitac.co', strict_min_version: '115.0' },
    },
  },
  vite: () => ({
    resolve: {
      alias: {
        'libsodium-wrappers-sumo': sodiumCjs,
      },
    },
  }),
});
