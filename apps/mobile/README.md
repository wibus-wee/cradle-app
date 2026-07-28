# Cradle Mobile

Cradle Mobile is the focused React Native controller for a Cradle Server. It
supports server onboarding, project workspaces, live chat sessions, Work
containers, and pull request review while away from the desktop.

## Run

```bash
pnpm install
pnpm --filter @cradle/mobile generate
pnpm --filter @cradle/mobile ios
```

The server must be reachable from the device. For a simulator, use the host
machine's LAN address instead of `localhost`. Enter the server access token
during onboarding when `CRADLE_AUTH_TOKEN` is enabled.

## Architecture

- `app/` owns navigation only.
- `src/features/*/*Container.tsx` owns API, persistence, and route dependencies.
- `src/features/*/*View.tsx` is fixture-renderable and receives typed props and
  callbacks.
- `src/api-gen/` is generated from the authoritative server OpenAPI document.
- Access tokens are stored in the platform keychain through Expo SecureStore.
