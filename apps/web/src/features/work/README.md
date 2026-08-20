# Work feature

This feature owns the web projection of a local Work container: Work queries,
the Work-owned conversation surface, header chrome, and the Right Aside
handoff/delivery panel. Workspace owns the unified Session sidebar and decorates
primary Work Session rows with Work status metadata.

Work reuses the primary Session conversation renderer. It does not fork Chat
Runtime state or create a second stream owner. Preparing is local-only; Draft PR
creation/update occurs only from an explicit user submit action. The delivery
panel reviews committed Work through a base-to-branch Diff Review instead of the
working-tree Changes tab, updates the cached Work immediately after marking a PR
ready, and reports GitHub success/failure through toasts.
