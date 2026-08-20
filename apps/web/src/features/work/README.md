# Work feature

This feature owns the web projection of a local Work container: Work queries,
the Work-owned conversation surface, explainable state and recovery badges,
the Needs me attention inbox, and the Right Aside handoff/delivery panel.
Workspace owns the unified Session sidebar and decorates primary Work Session
rows with Work status metadata.

Work reuses the primary Session conversation renderer. It does not fork Chat
Runtime state or create a second stream owner. Preparing is local-only; Draft PR
creation/update occurs only from an explicit user submit action. The delivery
panel reviews committed Work through a base-to-branch Diff Review instead of the
working-tree Changes tab, updates the cached Work immediately after marking a PR
ready, and reports GitHub success/failure through toasts.

The server is authoritative for state and attention projection. The web maps
stable state/authority/recovery codes to localized labels and renders the
server-owned evidence and next action without independently inferring terminal
state. New Work captures one explicit, verifiable acceptance criterion per line;
the criteria remain visible in the Work aside and travel through the generated
API contract.
