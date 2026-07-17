<!-- Once this directory changes, update this README.md -->

# locales

`src/locales` owns web i18n resources. `default/*.ts` is the authoring source of truth and runtime fallback for English copy. Locale JSON files are workflow-managed translation artifacts and must stay key-compatible with the default source.

## Files

- **default/chrome.ts**: App chrome, header, footer, and global frame copy.
- **default/chronicle.ts**: Chronicle settings, diagnostics, resource controls, and memory/activity copy.
- **default/agent-management.ts**: Agent Management detail, provider runtime settings, and model visibility copy.
- **default/common.ts**: Shared UI copy used across feature boundaries.
- **default/devtool.ts**: Development diagnostics, health, memory, observability, and plugin panel copy.
- **default/diff-review.ts**: Diff review guide and commit-plan copy.
- **default/home.ts**: Home dashboard sections, quick actions, relative time labels, and automation copy.
- **default/kanban.ts**: Kanban board, issue, filter, label, status, detail-panel, and issue Activity timeline copy.
- **default/new-chat.ts**: New chat composer placeholders, quick prompts, readiness notices, workspace picker, and recent session copy.
- **default/profile.ts**: Global profile page headings, metric labels, activity graph copy, and Usage-backed ranking labels.
- **default/runtimes.ts**: Runtimes settings page, ACP Registry install flows, and built-in runtime capability copy.
- **default/search.ts**: Global search command palette labels, groups, result metadata, and empty states.
- **default/settings.ts**: Settings navigation, appearance/language controls, chat archive recovery/search copy, and support/import/settings-section labels.
- **default/skills.ts**: Skill import flow labels, loading states, selection summaries, and completion copy.
- **default/system-agent.ts**: Jarvis/system-agent popover empty states and setup guidance.
- **default/usage.ts**: Usage analytics headings, chart labels, stat pills, and empty state copy.
- **default/work.ts**: Work creation, local execution, handoff, delivery, and sidebar copy.
- **default/workspace.ts**: Workspace sidebar app navigation, session menu read-state actions, file tree, workspace detail, workspace composer copy, and native open/reveal failure toasts.
- **default/index.ts**: Namespace registry used by runtime and workflow scripts.
- **en-US/*.json**: Generated baseline JSON for default English copy.
- **zh-CN/*.json**, **ja-JP/*.json**, **es-ES/*.json**: Supported non-default locale translation files.
