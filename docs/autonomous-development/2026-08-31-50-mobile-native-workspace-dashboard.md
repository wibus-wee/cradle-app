# Understand a workspace from a native iOS dashboard

- **Date:** 2026-08-31
- **Problem:** Workspace detail loaded repository identity and operational state but hid most of it, while presenting Work, conversations, and files through a custom list with a blank native navigation title.
- **Motivation:** Before resuming an agent or opening a file, mobile users need confidence that they are in the right repository and branch. Connecting that context to existing activity makes Workspace detail a useful dashboard instead of only a collection of links.
- **Product behavior:** iOS now uses the workspace name as the system navigation title and presents an inset-grouped SwiftUI list. A Workspace section exposes branch, local path, server availability, and pinned state. Work and conversations use labeled semantic SF Symbols, timestamps, disclosure affordances, and separate 44-point targets where Work has both session and info destinations. Files offer a native Browse All row plus the existing top-level shortcuts. Pull-to-refresh waits for the real refetch, and the existing workspace-scoped Work Composer collapses before navigation. Android and Web retain the existing detail view.
- **Implementation:** `WorkspaceView.ios.tsx` is a fixture-driven platform View over the existing callbacks and feature-owned Work Composer. The shared View contract uses API-owned types, and the Container supplies the iOS navigation title while preserving the custom title elsewhere.
- **Systems affected:** Mobile Workspace detail platform Views, shared Workspace View contract, Workspace query refresh callback, native route title, and workspace fixtures.
- **Validation:** Mobile TypeScript and ESLint passed; Expo production exports passed for iOS, Android, and Web.
- **Tradeoffs:** The dashboard shows the server-reported local path because it is valuable repository identity, although that path may not exist on the phone. File shortcuts remain capped at 12 to keep the dashboard scannable; Browse All exposes the complete tree.
- **Follow-up ideas:** Dogfood long monorepo paths and dense active Work sections; consider copy/share actions for repository identity if they prove useful in support workflows.
- **Out of scope:** File editing, file preview redesign, workspace pin mutations, archive operations, API changes, Work Composer migration, and Android detail migration.
