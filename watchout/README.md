# WatchOut

Independent **macOS 14+** Attention Object Store — parking slips for things you (or an agent) should handle later.

Not part of Cradle. Cradle may become a *client* later via MCP/CLI.

## Surfaces

| Surface | Role |
|---|---|
| **Menu bar app** (`LSUIElement`) | Always available; open count; quick list / create / complete |
| **Floating panel** | Draggable, optional always-on-top scratch panel |
| **CLI** `watchout` | `create` / `list` / `complete` / `reopen` / `delete` / `count` |
| **MCP** `watchout-mcp` | Same verbs for Cursor / other agents |

## Model (intentionally thin)

`AttentionItem`: `title`, optional `body` / `href`, `source`, `audience` (`human` \| `agent` \| `any`), `status` (`open` \| `done`).

- Opening something elsewhere does **not** complete an item.
- No handoff state machine. No auto-complete heuristics in v1.
- Explicit `complete` only.

SQLite path: `~/Library/Application Support/WatchOut/watchout.sqlite`

## Swift stack

- **SwiftUI** + `MenuBarExtra` + `Window` + `Settings`
- **GRDB** — local persistence
- **Defaults** — preferences
- **KeyboardShortcuts** — global hotkeys
- **LaunchAtLogin-Modern** — open at login
- **MenuBarExtraAccess** — menu bar panel presentation control
- **swift-argument-parser** — CLI
- **modelcontextprotocol/swift-sdk** — MCP server
- **swift-dependencies** — store injection for UI/tests

## Build (macOS only)

This environment cannot compile the AppKit/SwiftUI app. On a Mac:

```bash
cd watchout
swift build          # Core + CLI + MCP
swift test           # Core tests
chmod +x Scripts/generate-xcodeproj.sh
./Scripts/generate-xcodeproj.sh
open WatchOut.xcodeproj
```

Run the **WatchOut** scheme. For CLI/MCP products from SPM:

```bash
swift run watchout create "Review the session outcome"
swift run watchout list
swift run watchout-mcp
```

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
