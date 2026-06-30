<!-- Once this directory changes, update this README.md -->

# Features/Devtool/Resources

AppHeader resource popover for lightweight runtime diagnostics.

## Files

- **resources-popover-loader.ts**: Resources popover 的共享 lazy loader 与 intent preload 入口，供 AppHeader 在 diagnostics 区域 hover/focus 时预热
- **resources-popover.tsx**: ResourcesPopover trigger and popover content; samples renderer memory, server memory/CPU health, terminal memory/CPU resource snapshots, and Chronicle daemon memory/CPU resource state; exposes accessible trigger/refresh controls, surfaces partial endpoint failures instead of silently showing zero values, and records the resources popover first-render performance gate once all resource endpoints are ready after user open.
- **resources-popover.test.tsx**: Tests snapshot warning normalization, visible partial-failure feedback, compact terminal labels, and accessible trigger/refresh actions.
