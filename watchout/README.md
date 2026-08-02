# WatchOut

Independent **macOS 14+** Attention Object Store — parking slips for things you (or an agent) should handle later.

Not part of Cradle. Cradle may become a *client* later via MCP/CLI.

## Surfaces

| Surface | Role |
|---|---|
| **Menu bar app** (`LSUIElement`) | Always available; open count; quick list / create / complete |
| **Floating panel** | Draggable, optional always-on-top scratch panel |
| **CLI** `watchout` | `create` / `get` / `list` / `search` / `update` / `complete` / `reopen` / `delete` / `count` / `export` / `import` |
| **MCP** `watchout-mcp` | Same verbs for Cursor / other agents |

## Model (intentionally thin)

`AttentionItem`: `title`, optional `body` / `href`, `source`, `audience` (`human` \| `agent` \| `any`), `status` (`open` \| `done`).

- Opening something elsewhere does **not** complete an item.
- No handoff state machine. No auto-complete heuristics in v1.
- Explicit `complete` only.

SQLite path: `~/Library/Application Support/WatchOut/watchout.sqlite`

## Swift stack

- **SwiftUI** + `MenuBarExtra` + `Window` + `Settings`
- **GRDB** — local persistence + `ValueObservation` (live UI)
- **IdentifiedCollections** — identity-stable item arrays
- **swift-algorithms** — import dedupe (`uniqued`)
- **swift-async-algorithms** — debounced search
- **Defaults** — preferences
- **KeyboardShortcuts** — global hotkeys (incl. park clipboard)
- **LaunchAtLogin-Modern** — open at login
- **MenuBarExtraAccess** — menu bar panel presentation control
- **swift-argument-parser** — CLI
- **modelcontextprotocol/swift-sdk** — MCP server
- **swift-dependencies** — store injection for UI/tests

## Build (macOS only)

This Linux CI agent cannot compile AppKit/SwiftUI. On a Mac with **Xcode 16+**:

```bash
cd watchout
open WatchOut.xcodeproj
```

Select the **WatchOut** scheme → Run. The app is a menu-bar utility (`LSUIElement`).

SPM still owns Core / CLI / MCP (same folder’s `Package.swift`); the Xcode app target links local products `WatchOutUI` + `WatchOutCore`.

```bash
swift test           # Core tests
swift build          # CLI + MCP
swift run watchout create "Review the session outcome"
swift run watchout list
swift run watchout-mcp
```

`project.yml` + `Scripts/generate-xcodeproj.sh` remain as a regenerate path if the checked-in `WatchOut.xcodeproj` ever needs rebuilding via XcodeGen.
### MCP host config (example)

```json
{
  "mcpServers": {
    "watchout": {
      "command": "/path/to/watchout-mcp"
    }
  }
}
```

After `swift build -c release`, binaries land under `.build/release/`.

## Non-goals (for now)

- Embedding inside Cradle UI
- Auto-complete from dwell / activity signals
- Agent↔agent coordination bus
- Sync / accounts / cloud
