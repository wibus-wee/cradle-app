# Cradle Mobile

Native Cradle client for iPhone and iPad, built with SwiftUI and UIKit. The app
uses the Cradle Server OpenAPI document as its network contract and stores the
server token in the system Keychain.

## Generate and open

```sh
node apps/ios/scripts/sync-openapi.mjs
sh apps/ios/scripts/generate-api.sh
sh apps/ios/scripts/generate-app-icon.sh
cd apps/ios
xcodegen generate
open CradleMobile.xcodeproj
```

Generated Swift sources are committed so the iOS target links only the OpenAPI
runtime and URLSession transport, not the generator toolchain. The default
OpenAPI source is `http://localhost:21423/openapi.json`. Pass a file
path or another server URL as the first argument to `sync-openapi.mjs`.
The AppIcon generator uses FFmpeg with Lanczos scaling to derive the complete
iPhone, iPad, and App Store icon set from `resources/icon.png`, stripping the
alpha channel required to be absent from App Store icons.

For a physical device, use a server URL reachable from the device (for example,
the Mac's LAN or Tailscale address) and configure `CRADLE_AUTH_TOKEN` on the
server. Plain HTTP is allowed only for local development; HTTPS is recommended
for remote connections.

## Dependencies

- [MarkdownView](https://github.com/Lakr233/MarkdownView) for streaming Markdown
- [Swift OpenAPI Generator](https://github.com/apple/swift-openapi-generator),
  Runtime, and URLSession transport for typed server calls
- [swift-sse](https://github.com/DePasqualeOrg/swift-sse) for WHATWG-compliant stream parsing
- [KeychainAccess](https://github.com/kishikawakatsumi/KeychainAccess) for tokens
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) for reproducible projects
