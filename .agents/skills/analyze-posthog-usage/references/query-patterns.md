# Composable HogQL Patterns

Build analyses from the smallest relevant blocks. Replace example intervals and event/domain sets explicitly before execution. All examples are read-only and bounded.

## Contents

1. Base population
2. Activity and comparison
3. Returning actors
4. Feature breadth and combinations
5. Surface transitions
6. Event-relative next actions
7. Outcome and duration cuts
8. Data quality checks

## 1. Base population

Use a base CTE to define time, audience, and release filters once. Add or remove filters without changing downstream analysis.

```sql
WITH scoped_events AS (
    SELECT
        distinct_id,
        event,
        timestamp,
        properties
    FROM events
    WHERE timestamp >= now() - INTERVAL 28 DAY
      AND properties.audience = 'external'
      -- Optional: AND properties.build_channel = 'stable'
      -- Optional: AND properties.app_version = '0.12.0'
)
SELECT event, count() AS events, uniq(distinct_id) AS actors
FROM scoped_events
GROUP BY event
ORDER BY actors DESC, events DESC
LIMIT 100
```

For internal dogfooding, switch `audience` to `internal` and group by `internal_actor`; do not mix those numbers into external headlines.

## 2. Activity and comparison

Compose the active definition as an editable event set.

```sql
WITH activity AS (
    SELECT
        toStartOfWeek(timestamp) AS week,
        distinct_id
    FROM events
    WHERE timestamp >= now() - INTERVAL 8 WEEK
      AND properties.audience = 'external'
      AND event IN (
          'app_opened',
          'surface_viewed',
          'task_started',
          'task_finished'
      )
)
SELECT week, uniq(distinct_id) AS active_actors
FROM activity
GROUP BY week
ORDER BY week
```

For value engagement, use `event = 'task_finished' AND properties.outcome = 'success'`. Report any schema version 1 legacy events added for a rollout-spanning window.

## 3. Returning actors

This pattern compares two adjacent windows without requiring person profiles.

```sql
WITH actor_periods AS (
    SELECT
        distinct_id,
        countIf(timestamp >= now() - INTERVAL 7 DAY) > 0 AS current_active,
        countIf(
            timestamp >= now() - INTERVAL 14 DAY
            AND timestamp < now() - INTERVAL 7 DAY
        ) > 0 AS previous_active
    FROM events
    WHERE timestamp >= now() - INTERVAL 14 DAY
      AND properties.audience = 'external'
      AND event IN ('app_opened', 'surface_viewed', 'task_started', 'task_finished')
    GROUP BY distinct_id
)
SELECT
    countIf(current_active) AS current_actors,
    countIf(current_active AND previous_active) AS returning_actors,
    countIf(current_active AND NOT previous_active) AS current_only_actors
FROM actor_periods
```

Call the last group “not seen in the previous window,” not definitively “new,” unless the full identity history supports that statement.

## 4. Feature breadth and combinations

Count domains per actor, then aggregate the distribution.

```sql
WITH actor_domains AS (
    SELECT
        distinct_id,
        arraySort(groupUniqArray(properties.feature_domain)) AS domains
    FROM events
    WHERE timestamp >= now() - INTERVAL 28 DAY
      AND properties.audience = 'external'
      AND event = 'surface_viewed'
      AND properties.feature_domain IN (
          'chat', 'work', 'workspace', 'diff', 'kanban',
          'await', 'automation', 'plugins', 'jarvis'
      )
    GROUP BY distinct_id
)
SELECT
    length(domains) AS domain_count,
    count() AS actors
FROM actor_domains
GROUP BY domain_count
ORDER BY domain_count
```

For combinations, reuse `actor_domains` and group by `arrayStringConcat(domains, ' + ')`. Add `HAVING count() >= 2` for shared reports when tiny cohorts would be identifying or misleading.

Measure cross-feature value separately from surface discovery:

```sql
WITH actor_value_domains AS (
    SELECT
        distinct_id,
        arraySort(groupUniqArray(properties.feature_domain)) AS domains
    FROM events
    WHERE timestamp >= now() - INTERVAL 28 DAY
      AND properties.audience = 'external'
      AND event = 'task_finished'
      AND properties.outcome = 'success'
      AND properties.feature_domain IN (
          'chat', 'work', 'workspace', 'diff', 'kanban',
          'await', 'automation', 'plugins', 'jarvis'
      )
    GROUP BY distinct_id
)
SELECT
    length(domains) AS successful_domain_count,
    count() AS actors
FROM actor_value_domains
GROUP BY successful_domain_count
ORDER BY successful_domain_count
```

During the schema version 2 rollout, state that domains without task instrumentation can appear in discovery breadth but not value breadth.

## 5. Surface transitions

Use window functions to observe what surface follows another surface for the same anonymous actor.

```sql
WITH ordered AS (
    SELECT
        distinct_id,
        timestamp,
        properties.surface AS surface,
        leadInFrame(properties.surface, 1) OVER (
            PARTITION BY distinct_id
            ORDER BY timestamp
            ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
        ) AS next_surface,
        leadInFrame(timestamp, 1) OVER (
            PARTITION BY distinct_id
            ORDER BY timestamp
            ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
        ) AS next_timestamp
    FROM events
    WHERE timestamp >= now() - INTERVAL 14 DAY
      AND properties.audience = 'external'
      AND event = 'surface_viewed'
)
SELECT
    surface,
    next_surface,
    count() AS transitions,
    uniq(distinct_id) AS actors
FROM ordered
WHERE next_surface IS NOT NULL
  AND next_timestamp <= timestamp + INTERVAL 2 HOUR
GROUP BY surface, next_surface
ORDER BY actors DESC, transitions DESC
LIMIT 100
```

Change the maximum gap to match the question. A transition is temporal adjacency, not proof that the first surface caused the second.

## 6. Event-relative next actions

Generalize “what happens after X?” by changing only the anchor event and next-event allowlist.

```sql
WITH ordered AS (
    SELECT
        distinct_id,
        event,
        timestamp,
        leadInFrame(event, 1) OVER (
            PARTITION BY distinct_id
            ORDER BY timestamp
            ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
        ) AS next_event,
        leadInFrame(timestamp, 1) OVER (
            PARTITION BY distinct_id
            ORDER BY timestamp
            ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
        ) AS next_timestamp
    FROM events
    WHERE timestamp >= now() - INTERVAL 14 DAY
      AND properties.audience = 'external'
      AND event IN (
          'surface_viewed', 'task_started', 'task_finished'
      )
)
SELECT next_event, count() AS occurrences, uniq(distinct_id) AS actors
FROM ordered
WHERE event = 'task_finished'
  AND properties.feature_domain = 'work'
  AND properties.task_kind = 'work_create'
  AND next_event IS NOT NULL
  AND next_timestamp <= timestamp + INTERVAL 2 HOUR
GROUP BY next_event
ORDER BY actors DESC, occurrences DESC
```

If repeated passive events obscure the next meaningful action, remove them from the CTE allowlist rather than filtering after the window function.

## 7. Outcome and duration cuts

```sql
SELECT
    properties.outcome AS outcome,
    properties.duration_bucket AS duration_bucket,
    count() AS runs,
    uniq(distinct_id) AS actors
FROM events
WHERE timestamp >= now() - INTERVAL 28 DAY
  AND properties.audience = 'external'
  AND event = 'task_finished'
  AND properties.feature_domain = 'chat'
  AND properties.task_kind = 'agent_run'
GROUP BY outcome, duration_bucket
ORDER BY runs DESC
```

Segment by app version or platform when investigating regressions. Do not treat duration buckets as latency percentiles.

## 8. Data quality checks

Check event freshness and audience segmentation first:

```sql
SELECT
    event,
    properties.audience AS audience,
    max(timestamp) AS latest_event,
    count() AS events,
    uniq(distinct_id) AS actors
FROM events
WHERE timestamp >= now() - INTERVAL 14 DAY
GROUP BY event, audience
ORDER BY latest_event DESC
```

Check required common properties:

```sql
SELECT
    event,
    countIf(properties.audience IS NULL) AS missing_audience,
    countIf(properties.build_channel IS NULL) AS missing_build_channel,
    countIf(properties.app_version IS NULL) AS missing_app_version,
    countIf(properties.runtime_surface IS NULL) AS missing_runtime_surface,
    count() AS total
FROM events
WHERE timestamp >= now() - INTERVAL 14 DAY
GROUP BY event
ORDER BY total DESC
```

Check feature-domain coverage separately. A null domain can be valid for a supporting surface, so group by both `surface` and `feature_domain` before calling it missing instrumentation.

Check schema rollout and lifecycle projections:

```sql
SELECT
    properties.event_schema_version AS schema_version,
    properties.lifecycle_stage AS lifecycle_stage,
    properties.app_version AS app_version,
    count() AS opens,
    uniq(distinct_id) AS actors
FROM events
WHERE timestamp >= now() - INTERVAL 28 DAY
  AND event = 'app_opened'
GROUP BY schema_version, lifecycle_stage, app_version
ORDER BY app_version, lifecycle_stage
```

Null schema versions are historical version 1 events, not automatically corrupt rows.
