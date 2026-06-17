# Cowbird (browser extension)

An end-to-end encrypted password manager that stores everything in **your own
[HashiCorp Vault](https://www.vaultproject.io/)**. This is the browser-extension
client for [cowbird](https://github.com/cowbird-labs) — a TypeScript
reimplementation of the Go/Fyne desktop app, built to be **byte-compatible** with
it: encrypted blobs and Vault records written by either client can be read by the
other.

There is no Cowbird server and no third-party service. The extension talks
directly to the Vault instance you configure; all encryption and decryption happens
locally, and your unlock password never leaves the device.

## Features

- **Vault-backed storage** over the KV v2 secrets engine, with `userpass`, `token`,
  and `AppRole` authentication.
- **Items**: logins, cards, secure notes, identities, standalone passwords, and a
  custom type — each with arbitrary custom fields.
- **Autofill**: in-page field detection (including open shadow DOM), an on-focus
  inline menu of matching logins, and one-time-code (TOTP/2FA) fill.
- **Save / update detection**: offers to store a new login or update a changed
  password when you sign in or sign up on a site.
- **Sharing**: share items with other Vault identities and revoke access, using
  Ed25519-signed envelopes.
- **Key management**: change your unlock password, rotate your keypair, and
  export/import an encrypted recovery key.
- **Resilient sessions**: expired Vault tokens are renewed transparently; when
  renewal isn't possible the extension prompts you to re-authenticate without
  losing your unlocked session.

## Security model

- All key material and Vault access live in the **background service worker**. The
  popup UI and content scripts never touch Vault or crypto directly — they go
  through a typed message channel and only ever receive already-decrypted data.
- The Vault token, auth values, and unlocked private keys are held in
  `storage.session` (in-memory only, cleared when the browser closes). The unlock
  password is **never persisted**, so a browser restart always forces a re-unlock.
- Encryption uses libsodium primitives with an Argon2id key-derivation step
  (intentionally slow — unlock takes a few seconds), chosen to match the desktop
  app's formats exactly.
- Vault is reached from the worker using host permissions, so no CORS changes are
  needed on the Vault side.

## Tech stack

- **TypeScript** throughout.
- **React** for the popup UI.
- **[wxt](https://wxt.dev/)** (Vite-based) for the cross-browser build.
- **[libsodium-wrappers-sumo](https://github.com/jedisct1/libsodium.js)** +
  **hash-wasm** (Argon2id) for crypto.
- **webextension-polyfill** for the cross-browser extension API.
- **Vitest** for tests.

Targets **Chrome (MV3)** and **Firefox (MV2)**.

## Getting started

```bash
npm install
```

### Run in development

```bash
npm run dev            # Chrome (loads a dev profile)
npm run dev:firefox    # Firefox (auto-launches web-ext)
```

### Build

```bash
npm run build          # → .output/chrome-mv3/
npm run build:firefox  # → .output/firefox-mv2/
npm run zip            # packaged Chrome zip
npm run zip:firefox    # packaged Firefox zip
```

### Load a build unpacked

- **Chrome** — `chrome://extensions` → enable Developer mode → *Load unpacked* →
  select `.output/chrome-mv3`.
- **Firefox** — `about:debugging` → *This Firefox* → *Load Temporary Add-on* →
  select `.output/firefox-mv2/manifest.json` (or just use `npm run dev:firefox`).

### Tests and checks

```bash
npm test          # run the vitest suite
npm run test:watch
npm run typecheck # tsc --noEmit
```

## First run

1. Open the toolbar popup and enter your **Vault address** (e.g.
   `https://vault.example.com:8200`), the **KV v2 mount**, an optional namespace,
   and your **authentication method**.
2. **Sign in** to Vault with that method's credentials.
3. **Unlock** with your Cowbird password (first run initializes your identity).

## Project layout

```
entrypoints/        wxt entry points: background, popup, content script
src/
  crypto/           libsodium/Argon2 primitives, identity, item & key wrapping
  items/            item type definitions and codec
  vault/            KV v2 client, HTTP transport, typed store
  auth/             userpass / token / approle methods
  core/             config, session, identity, key rotation
  sharing/          envelope/signing protocol and sharing service
  background/       service worker: state, RPC handlers, token renewal
  messaging/        typed popup↔worker RPC + content-script message contracts
  autofill/         field detection, inline menu, submission capture, save prompt
  popup/            React UI (components, styles)
test/               vitest suites
```

## Compatibility

The crypto and on-disk formats are designed to round-trip with the cowbird desktop
app and any existing Vault data, validated by round-trip tests. A full cross-check
against desktop-app-written records on a live Vault is the remaining verification
step.

## License

[GPL-3.0-or-later](./LICENSE).
