# Pin important Mobile conversations

- **Date:** 2026-08-31
- **Problem:** Cradle already stored a pinned state for sessions, but Mobile could neither change nor recognize it. Important conversations therefore disappeared into the normal activity order when users returned to a workspace.
- **Motivation:** Pinning removes a repetitive search step from ongoing work and turns an existing server capability into a complete Mobile workflow.
- **Product behavior:** An iOS conversation now has a native Pin or Unpin item in its navigation toolbar. The selected state and filled SF Symbol reflect the current value, the control is disabled while saving, and a system alert explains failures without changing the visible state. Returning to the workspace shows pinned conversations first with an orange pin beside their title; unpinned conversations keep their prior relative activity order.
- **Implementation:** The existing session PATCH endpoint updates `pinned`. A successful mutation writes the returned session into the active chat query and invalidates workspace and project queries so the surrounding navigation reflects the change. The iOS workspace View performs a stable pinned-first sort without mutating its input and renders the server-owned session type directly. Its fixture now includes a pinned conversation.
- **Systems affected:** Mobile Chat Container, native iOS workspace conversation list, workspace fixture, and autonomous development journal.
- **Validation:** Mobile ESLint and TypeScript passed, and Expo production exports completed for iOS, Android, and Web.
- **Tradeoffs:** The action is intentionally a single native toolbar item rather than a menu. Pinning changes discovery order only inside the workspace; it does not add a separate global pinned inbox.
- **Follow-up ideas:** Add a native conversation details menu if rename or archive becomes a high-value Mobile workflow, and consider a global pinned section after usage evidence supports it.
- **Out of scope:** Session rename, archive/delete, workspace pinning, global navigation changes, server/API changes, and non-iOS presentation changes.
