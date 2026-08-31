# Cradle Mobile

Cradle Mobile is a native Controller for a Cradle Fabric. A production device
joins once, stores its identity in the platform keychain, discovers every Node
authorized by its grants, and carries the existing Workspace, Session, Work,
pull request, and streaming Chat APIs through an end-to-end encrypted Fabric
link. Mobile never stores a Cradle Server bearer token in this mode.

| Area | Owner |
| --- | --- |
| Navigation | `app/` |
| Fabric membership and Node selection | `src/features/fabric/` and `src/features/connection/` |
| Direct and Fabric request transports | `src/lib/transport/` |
| Feature data dependencies | `src/features/*/*Container.tsx` |
| Fixture-renderable UI | `src/features/*/*View.tsx` |
| Generated Server contracts | `src/api-gen/` |

## Run locally

Start the standalone Expo app from the repository root:

```bash
pnpm start:mobile
pnpm start:mobile ios
pnpm start:mobile android
pnpm start:mobile start
```

On macOS, the command without a platform opens the iOS Simulator. Use `start`
to show the Expo QR code for a physical device. Pass `--generate` after the
platform to refresh the generated API client, or `--clear` after dependency
changes to rebuild the Metro cache.

The command starts only Mobile; it does not start relayd or a Cradle Server.
Production onboarding accepts the versioned Controller pairing code shown by
an owner in Node settings. Settings also exposes a direct Server URL/token
connection as an explicit development transport. Direct credentials use secure
storage and never become a fallback for an existing Fabric membership.

## Fabric transport

The pairing code pins the Relay URL, Fabric ID, and owner public key. Mobile
creates Ed25519 and X25519 keys, waits for owner approval, validates the returned
certificate, and discovers only Nodes with active grants. Selecting a Node
changes the connection resource identity to `(fabricId, nodeId)`, which also
scopes query and persisted Chat caches.

Each selected Node uses one authenticated Relay WebSocket and a multiplexed
Fabric Session. `src/lib/transport/fabric-http-codec.ts` serializes the existing
API calls as HTTP/1.1 byte streams and exposes response bodies through Cradle's
fetch-compatible streaming response contract. JSON, chunked bodies, SSE,
cancellation, flow-control acknowledgement, foreground recovery, single-grant
loss, and whole-Controller revocation therefore share one transport boundary.

Private Controller keys use Expo SecureStore with device-only accessibility.
The iOS project declares its Keychain access group in both `app.json` and the
tracked native entitlement so Expo prebuild and Xcode builds retain the same
capability.

## Native iOS E2E

Run the production Release bundle against a real two-Node local Fabric:

```bash
pnpm e2e:fabric:mobile:ios
```

The runner requires macOS, Xcode with an iOS Simulator runtime, CocoaPods, and
Java 17. It downloads the pinned Maestro CLI from its official release URL,
verifies the archive checksum, creates and later deletes one ephemeral
Simulator, installs the signed Release app, and starts the existing relayd,
two-Server, and Web topology.

`CRADLE-FABRIC-002` drives the native app with Maestro and the owner UI with
Playwright. It enrolls one Controller, approves two Node grants, proves
Node-scoped Workspace isolation, switches Nodes, continues a real Codex Chat
through Fabric SSE, removes one grant without losing the other Node, and then
revokes the Controller. Failure artifacts are written under
`e2e/artifacts/mobile-fabric/`.

For local iteration, `CRADLE_E2E_IOS_APP_PATH` may point to an already-built
`.app`, and `CRADLE_E2E_IOS_UDID` may select a caller-owned booted Simulator.
The runner never deletes a caller-owned Simulator.

## Native Markdown

Assistant Markdown uses the native `MarkdownView` UIKit view on iOS. The Expo
config plugin adds the Swift Package to generated projects, and the inline Expo
module owns the bridge. Expo Go cannot load this custom native view; use an iOS
development build or the tracked native project.
