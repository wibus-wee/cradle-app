# Carry workspace context into palette creation

- **Date:** 2026-08-31
- **Problem:** “New conversation” and “New Work” in the command palette discarded the active workspace, forcing users to reselect the project on the destination surface.
- **Motivation:** Creation commands should preserve the context from which they are invoked, especially for Work where the workspace defines the isolation source.
- **Product behavior:** From a workspace-aware conversation, new-chat, or workspace surface, both creation commands display the active workspace name and open with that workspace preselected. They retain their global behavior when no workspace is available.
- **Implementation:** Reused the palette’s existing active-workspace resolution and the typed `workspaceId` options on the navigation commands. No new route, store, or persistence mechanism was added.
- **Systems affected:** Desktop global search command data and search feature documentation.
- **Validation:** Web TypeScript typecheck, scoped ESLint, and diff validation.
- **Tradeoffs:** Surfaces that do not currently participate in palette file-workspace resolution still open creation without a preselection.
- **Follow-up ideas:** Extend the shared surface-to-workspace resolver when more surface kinds gain an unambiguous workspace owner.
