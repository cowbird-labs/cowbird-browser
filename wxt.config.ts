import { defineConfig } from 'wxt';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// wxt builds the extension for both Chrome and Firefox MV3 from one source,
// handling the background (service worker vs event page) and manifest
// differences automatically. Entry points live in ./entrypoints; all app logic
// stays in ./src and is imported by thin entrypoint wrappers.

const require = createRequire(import.meta.url);
// Alias the broken ESM build of libsodium-wrappers-sumo to its CJS entry (the
// same fix used in vitest.config.ts); Vite bundles the CJS with embedded WASM.
const sodiumCjs = require.resolve('libsodium-wrappers-sumo');
// totp-generator has a `require('node:crypto')` Node fallback that is never taken
// in the browser; alias it to a Web Crypto stub so the bundler doesn't externalize
// a Node builtin (and warn) — see src/shims/node-crypto.ts.
const nodeCryptoShim = fileURLToPath(new URL('./src/shims/node-crypto.ts', import.meta.url));

export default defineConfig({
  // @vitejs/plugin-react v6 (pulled in by @wxt-dev/module-react) auto-detects
  // wxt's Vite 8 / Rolldown and uses the oxc transform, avoiding the
  // `esbuild`/`optimizeDeps.esbuildOptions` deprecation warnings the older
  // babel-based v4 plugin emitted under Vite 8.
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
    // Firefox needs an explicit add-on id. Min version 142: storage.session needs
    // ≥115, but data_collection_permissions is honored only on Firefox ≥140 /
    // Firefox for Android ≥142, so 142 clears the AMO version-mismatch warnings.
    browser_specific_settings: {
      gecko: {
        id: 'cowbird@avitac.co',
        strict_min_version: '142.0',
        // websiteContent: autofill reads page structure/field hints. authenticationInfo:
        // the save-credential flow captures passwords/usernames typed into page forms
        // (and the manager stores logins generally) — Mozilla treats credentials as a
        // distinct sensitive category from generic page content, so declare both.
        data_collection_permissions: {
          required: ['websiteContent', 'authenticationInfo'],
          optional: [],
        },
      },
    },
  },
  vite: () => ({
    resolve: {
      alias: {
        'libsodium-wrappers-sumo': sodiumCjs,
        'node:crypto': nodeCryptoShim,
      },
    },
  }),
});
