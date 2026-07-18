# Product Analytics

This feature owns Cradle's anonymous product-usage analytics boundary. PostHog
is a transport only: feature code emits typed semantic events through
`trackProductEvent` or the task lifecycle helpers, while this module owns
consent, common release markers, lifecycle projection, surface normalization,
and privacy-safe property allowlists.

Automatic DOM capture, raw route pageviews, exception capture, person profiles,
and session recording are disabled. Never add prompts, responses, file paths,
repository names, user-generated labels, external URLs, raw errors, or Cradle
resource IDs to product analytics properties.

## Configuration

- `VITE_POSTHOG_PROJECT_TOKEN`: PostHog project token. Analytics does not load without it.
- `VITE_POSTHOG_HOST`: ingestion host; defaults to `https://us.i.posthog.com`.
- `VITE_POSTHOG_BUILD_CHANNEL`: release marker; defaults to `dev` or `stable`.
- `VITE_POSTHOG_AUDIENCE`: set to `internal` for internal packaged builds.
- `VITE_POSTHOG_INTERNAL_ACTOR`: optional internal-only actor label.

Desktop release builds inject these from the repository Actions secret
`POSTHOG_PROJECT_TOKEN` in `release-desktop.yml`:

| Channel | `build_channel` | `audience` | Product analytics | AI Observability |
| --- | --- | --- | --- | --- |
| `dev` | `development` | `internal` | on | on (`full`) |
| `bleeding-edge` | `bleeding-edge` | `internal` | on | on (`full`) |
| `release` | `release` | `external` | on | off |

The user-facing setting is enabled by default and persisted under the
Cradle-owned `cradle:product-analytics:v1` local-storage namespace. App-open
lifecycle state uses `cradle:product-analytics:lifecycle:v1` and represents the
first version observed while analytics is enabled, not a guaranteed install date.

## Event contract

All events include `event_schema_version`; schema version 2 uses:

- `app_opened`: process-level open with `first_seen`, `returning`, or `updated` lifecycle stage.
- `surface_viewed`: normalized surface and optional product-value domain.
- `onboarding_completed`: onboarding success milestone.
- `task_started`: a typed product-value task began.
- `task_finished`: the same typed task ended with outcome, duration bucket, and allowlisted failure category.

Chat task events may also include server-issued opaque `session_id` and `run_id`
properties. These correlate a product task with the matching AI generation without
uploading Cradle resource IDs.

Tasks use a discriminated `feature_domain + task_kind + task_variant` contract.
Add new task combinations to `event-model.ts`; never pass arbitrary labels from
feature code. Record a specific failure category only when the product knows its
semantics. Otherwise use `unknown` and never upload raw errors.

## Current task coverage

- Chat: agent run.
- Work: work creation, draft submission, and mark ready.
- Workspace: local or remote workspace addition.

Other domains currently have surface adoption only. Add task coverage when a
stable success or failure boundary is available; do not instrument clicks merely
to make the catalog look complete.
