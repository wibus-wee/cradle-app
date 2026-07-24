# Workspace Detail

Workspace Detail presents workspace-owned instructions, workflow rules, skills,
and the entry composer for a new conversation.

## Dependency ownership

- `workspace-detail-route-content.tsx` owns the route surface title and layout
  slots.
- `use-workspace-detail-owner.ts` owns workspace/file queries, mutations,
  session creation, optimistic chat startup, navigation, and runtime settings.
- `workspace-detail-page-container.tsx` assembles the real chat composer and
  lazy workflow/skills panes.
- `workspace-workflow-rules-container.tsx` owns the agents inventory and
  workflow-rule query/mutation; its View and editor are props-only modules.
- `workspace-detail-page-view.tsx` owns only page layout, document scrolling,
  and the local outline state derived from rendered headings.
- Title, tabs, document, outline, and loading surfaces each live in their own
  props-only View module.

## Rendering seam

`WorkspaceDetailPageView` receives an owner-typed `Workspace`, the AGENTS.md
document state, current tab, outline headings, callbacks, and three content
slots. Storybook supplies fixture slots instead of mounting query, router,
store, or runtime providers.

`fixtures/workspace-detail.ts` provides local and remote Workspace fixtures plus
an AGENTS.md outline. `workspace-detail-page-view.stories.tsx` covers ready,
empty, loading, saving, remote, workflow-rules, skills, and page-loading states.
`workspace-workflow-rules-view.stories.tsx` covers global, agent-specific,
empty-agent, and pending readiness states.

Saving AGENTS.md still uses the workspace file adapter with explicit
non-Cradle-owned write confirmation.
