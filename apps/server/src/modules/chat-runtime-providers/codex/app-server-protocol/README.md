# Codex App-Server Protocol

Generated TypeScript bindings for the Codex app-server JSON-RPC protocol.

Regenerate with:

```bash
pnpm --filter @cradle/server generate:codex-app-server-protocol
```

`MANIFEST.json` records the Codex CLI version that produced the checked-in schema. Codex app-server does not currently emit a separate schema version in generated files, so `generatorVersion` is the version to compare against the vendored Codex runtime.

These files are adapter-owned protocol bindings. Do not edit generated `.ts` files by hand; update the Codex runtime through `pnpm --filter @cradle/desktop sync:codex-runtime`, regenerate this directory, and then adapt provider code to any protocol changes.
