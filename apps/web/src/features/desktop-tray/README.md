# Desktop Tray Feature

Main-window action bridge for Electron Desktop tray commands and native desktop notification session refresh events.

## Files

- **api.ts**: Fetch boundary for Desktop-owned await projection endpoints used by the awaits overview.
- **types.ts**: Local desktop action and await contracts shared by the main-window bridge.
- **use-desktop-tray-action-bridge.ts**: Main-window subscription that maps native desktop IPC actions to tab navigation, settings sections, global search, chat session query refresh after native notification replies, and `open-workspace` deep-link navigation (including workspace list invalidation after CLI register-then-open).
