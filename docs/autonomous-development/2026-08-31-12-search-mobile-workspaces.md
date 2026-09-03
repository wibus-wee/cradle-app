# Search Mobile workspaces

- **Date:** 2026-08-31
- **Problem:** Mobile users had to scan the complete project list to find a workspace.
- **Motivation:** Workspace selection is the first step for most Mobile control workflows and should stay fast as the server manages more projects.
- **Product behavior:** The Projects screen now filters immediately by workspace name, identifier, or current branch and explains how to recover from no matches.
- **Implementation:** `ProjectsView` owns transient search state and filters its existing typed project summaries without constraining the Work composer's workspace choices.
- **Systems affected:** Mobile Projects list UI only.
- **Validation:** Mobile TypeScript and targeted ESLint checks.
- **Tradeoffs:** Search covers the already-loaded project set rather than querying the server.
- **Follow-up ideas:** Add recent-workspace ranking if search becomes the dominant navigation path.
- **Out of scope:** Server search, saved queries, and Work composer filtering.
