# Cradle Mobile

Cradle Mobile is the focused React Native controller for a Cradle Server. It
supports server onboarding, project workspaces, live chat sessions, Work
containers, and pull request review while away from the desktop.
Pull request lists and details support pull-to-refresh; both force an upstream
GitHub update before reloading their Cradle projections.
Initial data-load failures expose an in-place Retry action across Projects,
Work, Usage, pull requests, and conversations.
Work detail supports pull-to-refresh for readiness and pull-request state even
after active Work polling has stopped, without replacing handoff edits in progress.
Workspace detail file rows open a refreshable, read-only mobile preview for
text and Markdown files; previews can be handed to other apps through the
system share sheet, while unsupported binary formats are identified explicitly.

## Run

Start the standalone Expo app from the repository root:

```bash
pnpm start:mobile
pnpm start:mobile ios
pnpm start:mobile android
pnpm start:mobile start
```

On macOS, the command without a platform opens the iOS Simulator. Use `start`
to show the Expo QR code for a physical device.

Pass `--generate` after the platform to refresh the generated API client:

```bash
pnpm start:mobile ios --generate
```

Pass `--clear` after dependency changes to rebuild the Metro cache:

```bash
pnpm start:mobile --clear
```

The script starts only the standalone Mobile GUI. It never starts or manages a
Cradle Server. The server must already be reachable from the device. Enter its
URL and access token during onboarding; both values can be changed later in
Settings.

## Architecture

- `app/` owns navigation only.
- `src/features/*/*Container.tsx` owns API, persistence, and route dependencies.
- `src/features/*/*View.tsx` is fixture-renderable and receives typed props and
  callbacks.
- `src/features/projects/FilePreviewContainer.tsx` reads workspace-owned file
  metadata before requesting text content and owns the native share handoff;
  its View never reads routes, native APIs, or API state.
- Work detail query and mutation state remain in `WorkDetailContainer`; the
  fixture-driven View owns handoff draft interaction and native refresh presentation.
- Root destinations use an anchored navigation menu; detail surfaces use Expo
  Router's native Stack navigation and back gestures.
- `src/api-gen/` is generated from the authoritative server OpenAPI document.
- Access tokens are stored in the platform keychain through Expo SecureStore
  on iOS and Android, and in browser storage on Web.

## iOS Markdown rendering

Assistant Markdown is rendered by the native `MarkdownView` UIKit view on iOS.
The Expo config plugin adds the Swift Package to generated Xcode projects, and
the inline Expo module keeps the bridge in source control without committing a
generated `ios/` directory. Use an iOS development build or a locally
generated native project; Expo Go cannot load this custom native view.
