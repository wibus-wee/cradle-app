---
name: analyze-posthog-usage
description: Query PostHog product analytics with read-only HogQL, explore anonymous user activity and journeys, model feature adoption and cross-feature behavior, audit instrumentation quality, and turn evidence into product hypotheses. Use when Codex needs to answer whether a product still has users, what users do before or after an event or surface, which features or combinations they use, how internal and external usage differ, whether an analytics event model is sufficient, or what product and instrumentation questions to investigate next.
---

# Analyze PostHog Usage

Use PostHog as an evidence source, not as a fixed dashboard. Compose small, bounded queries around the user's current question, then explain what the results support, what they do not support, and what to investigate next.

## Workflow

1. Establish the question and decision. If the user is exploratory, default to recent activity, journeys, adoption breadth, and anomalies rather than asking for a full metric specification.
2. Inspect the product's current analytics source of truth. For Cradle, read [references/event-model.md](references/event-model.md) and refresh it from the referenced TypeScript source when the code has changed.
3. Choose a cohort and time window. Default to both a short window (7 days) and a comparison window (previous 7 days or 28-day context). State the choice. Keep internal usage visible but separate it from external headline metrics.
4. Read [references/query-patterns.md](references/query-patterns.md) and compose only the query blocks needed for the question.
5. Run named HogQL queries with `scripts/posthog_query.py`. Start with data availability and quality before interpreting behavior.
6. Cross-check important conclusions with a second cut, such as another time window, audience, build channel, app version, or minimum-activity threshold.
7. Report evidence, interpretation, uncertainty, and the smallest useful next action. Suggest product or instrumentation changes, but do not make them unless the user separately asks.

## Query PostHog

Require these local secrets and configuration:

```text
POSTHOG_PERSONAL_API_KEY  # project-scoped Personal API Key with Query Read only
POSTHOG_PROJECT_ID
POSTHOG_API_HOST          # for example https://us.posthog.com
```

Never use or request the public `phc_...` project token for reads. Never commit a personal key or paste it into output. Prefer a gitignored environment file and pass it with `--env-file`.

Run a query from a file:

```bash
python3 scripts/posthog_query.py \
  --env-file /path/to/private.env \
  --file /tmp/question.hogql \
  --name weekly_external_activity
```

Run a small query from standard input:

```bash
printf '%s\n' "SELECT count() FROM events WHERE timestamp >= now() - INTERVAL 7 DAY" \
  | python3 scripts/posthog_query.py --name seven_day_event_count
```

Use `--format json` when another program will consume the response and `--format tsv` for compact tabular inspection. Use `--check` to verify credentials with `SELECT 1`.

## Compose Analysis

Treat these dimensions as independent blocks that can be combined:

- **Population:** all anonymous actors, external users, internal users, a build channel, app version, platform, or window kind.
- **Time:** current period, comparison period, retention interval, or event-relative window.
- **Activity:** opening, meaningful events, successful outcomes, or a user-defined event set.
- **Journey:** previous/next event, previous/next surface, transitions, sequences, or time-to-next-action.
- **Breadth:** distinct events, surfaces, feature domains, or feature combinations per actor.
- **Quality:** missing properties, unknown domains, duplicated lifecycle events, sparse samples, or version skew.

Do not turn a convenient event into a universal definition. Define “active,” “engaged,” “adopted,” and “returning” explicitly for each analysis. Prefer event and domain sets that can be changed without editing the query runner.

## Interpretation Guardrails

- Distinguish “no captured activity” from “no users.” Check ingestion health and filters first.
- Treat `distinct_id` as an anonymous actor identifier, not a known human or guaranteed cross-device identity.
- Do not infer intent from navigation alone. State behavioral observations before product interpretations.
- Do not claim causation from correlations or before/after comparisons.
- Suppress or generalize tiny cohorts in shared reports. Avoid exposing raw actor IDs unless debugging locally requires it.
- Never query or display prompts, responses, file paths, repository names, URLs, raw errors, resource IDs, or other user content.
- Use short date ranges, explicit limits, and meaningful query names. The Query API is for bounded analysis, not bulk export.
- Stay read-only. Do not create insights, dashboards, cohorts, feature flags, annotations, or mutations through PostHog.

## Report to a Product Owner

Lead with the answer, not the query mechanics. Keep the default report compact:

1. **What happened:** the strongest observed facts and comparison.
2. **What it may mean:** one or two plausible interpretations, labeled as interpretation.
3. **Confidence:** sample size, data quality, and important caveats.
4. **Next move:** one product question, experiment, or instrumentation improvement with the highest information value.

For open-ended exploration, include one surprising or contradictory observation. Prefer a new testable question over a long backlog of speculative recommendations.

