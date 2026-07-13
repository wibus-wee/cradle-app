# secrets

Route metadata includes `x-cradle-cli` descriptors for safe generated CLI commands.
Secret value writes and explicit reveal actions are intentionally not exposed through the generated CLI.

- `secrets.module.ts` — wires secret lifecycle providers and controller.
- `secrets.controller.ts` — exposes `/secrets` CRUD endpoints.
- `secrets.service.ts` — validates configuration and maps secret errors.
- `secrets.store.ts` — persists encrypted secrets and masked metadata.
- `secret-cipher.ts` — AES-256-GCM wrapper around `CRADLE_CREDENTIAL_SECRET`.
- `types.ts` — shared secret API shapes.
