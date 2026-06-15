import { defineConfig } from 'vitest/config';
import { createRequire } from 'node:module';

// The ESM build of libsodium-wrappers-sumo ships a broken internal import
// (./libsodium-sumo.mjs, which lives in a sibling package). The CJS build
// resolves libsodium-sumo correctly, so alias the bare specifier to it. Vite
// transparently interops the CJS default export.
const require = createRequire(import.meta.url);
const sodiumCjs = require.resolve('libsodium-wrappers-sumo');

export default defineConfig({
  resolve: {
    alias: {
      'libsodium-wrappers-sumo': sodiumCjs,
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Argon2id (kdfV2, time=25) runs ~3.5s per derivation in WASM without
    // native threads, so identity lock/unlock tests need a generous timeout.
    testTimeout: 120_000,
  },
});
