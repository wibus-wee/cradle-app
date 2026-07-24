# components/ui

`components/ui` 归属 web design-system primitive 层。这里的组件应该是跨功能、低业务语义、可组合的基础 UI building blocks，例如 `Button`、`Input`、`Dialog`、`Tabs`、`Tooltip`、`Menu`、`Progress`。

## Placement Boundaries

- 放在 `components/ui`：可被任意 feature 复用的基础 primitive、design-system token wrapper、低语义组合控件。
- 放在 `components/common`：只服务 Cradle app 的共享 UI，包含 app chrome、route fallback、empty state composition、app-specific visual treatment。
- 放在 `features/{domain}`：带有业务语义、数据读取、mutation、store ownership、route ownership 或 domain copy 的组件。

## Rules

- Tailwind classes must stay static. Use `cn()` for conditional composition and static maps for variants.
- Prefer concrete transition properties such as `transition-colors`, `transition-opacity`, `transition-transform`, or `transition-[background-color,border-color,color,box-shadow]`.
- Keep primitive props business-neutral. A primitive can expose `variant`, `size`, `disabled`, `aria-*`, and render-slot props, but it should not know about sessions, chats, workspaces, providers, agents, or routes.
- New app-specific shared components should start in `components/common` or the owning feature. Move into `components/ui` only after the primitive contract is stable and business-neutral.
- Host-specific behavior enters through narrow UI contexts such as `overlay-environment.tsx`; primitives must not import feature stores or Electron adapters directly.

## Inventory Notes

- `button.tsx`, `input.tsx`, `dialog.tsx`, `command.tsx`, `menu.tsx` (including exported shortcut text support), `tabs.tsx`, `tooltip.tsx`, `switch.tsx`, `progress.tsx`, `spinner.tsx`, and similar files are design-system primitives. `spinner.tsx` also exports delayed busy-state helpers for VS Code-style latency thresholds.
- `overlay-environment.tsx` is the host seam used by Dialog, AlertDialog, and Sheet to suppress native surfaces without importing browser feature state. The application injects the browser adapter; isolated previews use the no-op default.
- `canvas-art.tsx`, `route-loading-fallback.tsx`, `icon-picker.tsx`, and `preview-card.tsx` should be reviewed before future expansion because they may be app-specific shared UI rather than universal primitives; canvas decorations that animate should expose an `active` control so retained hidden tabs can stop rAF work without unmounting DOM.
