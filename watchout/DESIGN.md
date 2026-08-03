# WatchOut design direction

WatchOut is an attention parking lot, not another dashboard. Its job is to reduce the cost of context switching: capture a loose end quickly, make the open queue legible, and let the user decide when something is complete.

## macOS Liquid Glass principles applied

- **Glass is the functional layer.** The menu-bar header, search, segmented filter, and capture composer are the floating control layer. Attention rows stay in the content layer so text does not compete with the material.
- **Concentric geometry.** The panel, toolbar, search field, rows, and composer use nested continuous shapes with predictable insets rather than unrelated corner radii.
- **Content first.** Source, age, body preview, and link affordances are visible in the row. Destructive actions appear on hover or in the context menu instead of permanently occupying the visual field.
- **Capture before categorization.** Quick capture accepts a title with one action. Body text, links, source metadata, CLI, and MCP remain available without making the first interaction feel like a form.
- **Hierarchy through grouping.** Open/Done is a compact segmented filter; overflow actions are grouped in a menu with symbols; the primary action is the only prominent button.
- **Adaptivity and accessibility.** The native Liquid Glass APIs are used on macOS 26 and newer, with a material fallback for macOS 14–25. System Reduced Transparency, Increased Contrast, and Reduced Motion remain authoritative.

## UX changes

1. The menu-bar panel now opens directly into an `Open` queue with an adjacent `Done` view.
2. Rows show a short body preview and source symbol when available.
3. Delete stays out of the resting state and appears on hover; all actions remain available through the context menu.
4. Quick capture is the strongest action and is available from the menu-bar panel, floating window, clipboard shortcut, and global quick-capture shortcut.
5. The larger floating window adds a lightweight orientation strip: open now, parked this week, and overdue. These are orientation cues, not a second workflow.

## Apple references

- [Meet Liquid Glass — WWDC25](https://developer.apple.com/videos/play/wwdc2025/219/)
- [Get to know the new design system — WWDC25](https://developer.apple.com/videos/play/wwdc2025/356/)
- [Build an AppKit app with the new design — WWDC25](https://developer.apple.com/videos/play/wwdc2025/310/)
- [Materials — Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/materials)
- [Toolbars — Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/toolbars)
