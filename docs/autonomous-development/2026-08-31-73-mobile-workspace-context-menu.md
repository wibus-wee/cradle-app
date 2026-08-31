# Reach workspace files from a native context menu

- **Date:** 2026-08-31
- **Problem:** Opening workspace files from the Mobile workspace list required entering the workspace dashboard first, even when browsing files was the user's intent.
- **Motivation:** Native context menus give iPhone long-press and iPad pointer users a fast secondary path without adding persistent row controls.
- **Product behavior:** Long-pressing or secondary-clicking an available workspace now offers Open Workspace and Browse Files. The existing row tap remains the primary action. Unavailable workspaces keep their direct detail route and do not expose an action that would fail.
- **Implementation summary:** Added a container-owned file-navigation callback to the existing Projects View contract and wrapped available SwiftUI rows in Expo UI's native ContextMenu. Both actions dismiss the Work composer and keyboard before navigating.
- **Files / systems affected:** Mobile workspace list rendering, its fixture-driven View contract, and Mobile navigation.
- **Validation performed:** Targeted Mobile ESLint, TypeScript typecheck, and diff whitespace validation.
- **Tradeoffs:** Pin controls remain in workspace detail, where the state change is visible. The menu intentionally contains only two high-frequency navigation actions.
- **Follow-up ideas:** Add direct file actions to workspace search results when richer file indexing becomes available.
- **Out of scope:** Workspace mutations, unavailable-workspace recovery, Android UI, and desktop/web surfaces.
