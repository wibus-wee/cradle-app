# Cradle Product Analytics Event Model

Use this reference for Cradle-specific semantics. Treat the TypeScript definitions in `apps/web/src/features/product-analytics/client.ts` as the source of truth and refresh this file when they diverge.

## Privacy and identity boundary

- Events are anonymous and enabled by default with a user opt-out.
- `distinct_id` identifies an anonymous installation/browser persistence context. Do not describe it as an account or guaranteed person.
- PostHog autocapture, raw pageviews, exception capture, session replay, and person profiles are disabled.
- Do not collect or query user content, prompts, responses, paths, repository names, labels, URLs, raw errors, or Cradle resource IDs.

## Common properties

Every semantic event should carry:

| Property | Meaning |
| --- | --- |
| `app_version` | Cradle package version |
| `audience` | `internal` or `external` |
| `build_channel` | For example `dev` or `stable` |
| `event_schema_version` | Numeric semantic event contract version; version 2 is current |
| `internal_actor` | Optional internal-only label such as `founder`; null externally |
| `platform` | Runtime operating system |
| `runtime_surface` | `electron` or `browser` |
| `window_kind` | `main` or `tearoff` |

Use `audience = 'external'` for product headline numbers. Analyze internal usage separately for dogfooding patterns and instrumentation verification.

## Semantic events

| Event | Event properties | Interpretation |
| --- | --- | --- |
| `app_opened` | `lifecycle_stage`, `previous_version` | Enabled process-level app open; lifecycle is first observed, returning, or updated |
| `surface_viewed` | `surface`, `feature_domain` | Normalized product surface became active |
| `onboarding_completed` | none | Initial onboarding completed |
| `task_started` | `feature_domain`, `task_kind`, `task_variant` | Typed product-value task began |
| `task_finished` | task properties plus `outcome`, `duration_bucket`, `failure_category` | Typed task reached a terminal state |

Outcome values are `success`, `failed`, and where supported `cancelled`. Duration buckets are `under_10s`, `10s_30s`, `30s_2m`, `2m_10m`, and `over_10m`. Failure categories are allowlisted coarse semantics; `unknown` is required instead of inspecting or uploading raw errors.

Current task combinations are:

| Feature domain | Task kind | Variants |
| --- | --- | --- |
| `chat` | `agent_run` | none |
| `work` | `work_create` | `new_work`, `issue` |
| `work` | `draft_submit` | `create_draft`, `update_draft` |
| `work` | `mark_ready` | none |
| `workspace` | `workspace_add` | `local`, `remote` |

Schema version 1 used domain-specific events including `agent_run_started`, `agent_run_finished`, `workspace_added`, and `work_*`. Include them only when analyzing historical periods that cross the version 2 rollout.

## Product value domains

Current domain vocabulary:

```text
chat, work, workspace, diff, kanban, await, automation, plugins, jarvis
```

Settings, Usage, and Onboarding are supporting surfaces and do not count as product-value domains.

The domain vocabulary is intentionally separate from event names. Analyze breadth using `surface_viewed.properties.feature_domain`, and analyze depth/outcomes using domain-specific semantic events. At the time of this reference, `jarvis` exists in the type vocabulary but is not mapped by `featureDomainForSurface`; therefore it is not reliably observable as a viewed domain until instrumentation is added.

## Working metric definitions

These are defaults, not permanent business truth:

- **Weekly opener:** anonymous actor with at least one `app_opened` in a week.
- **Weekly engaged actor:** anonymous actor with at least one successful `task_finished`. State any additional legacy event set in every report.
- **Returning actor:** actor active in both the current and comparison periods.
- **Feature discovery:** actor viewed a product-value domain.
- **Feature value adoption:** actor completed a successful task in that domain.
- **Cross-feature discovery actor:** actor viewed at least two distinct product-value domains in the period.
- **Cross-feature value actor:** actor completed successful tasks in at least two distinct domains.

Change definitions when the product question demands it. Never silently change them between comparison periods.
