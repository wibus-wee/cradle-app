const path = require('node:path')

const RESPONSE_BANDS = [
  { id: 'instant', label: 'Instant', maximumMs: 100 },
  { id: 'perceptible', label: 'Perceptible', maximumMs: 1_000 },
  { id: 'flow-breaking', label: 'Flow breaking', maximumMs: 10_000 },
  { id: 'severe', label: 'Severe wait', maximumMs: Number.POSITIVE_INFINITY },
]

const STATUS_RANK = {
  UNKNOWN: 0,
  PASSED: 1,
  SKIPPED: 2,
  PENDING: 3,
  UNDEFINED: 4,
  AMBIGUOUS: 5,
  FAILED: 6,
}

function normalizeStatus(status) {
  return String(status || 'UNKNOWN').toUpperCase()
}

function durationMilliseconds(duration) {
  return Number(duration?.seconds || 0) * 1_000 + Number(duration?.nanos || 0) / 1_000_000
}

function roundMilliseconds(value) {
  return Math.round(value * 1_000) / 1_000
}

function worstStatus(left, right) {
  const normalizedLeft = normalizeStatus(left)
  const normalizedRight = normalizeStatus(right)
  return (STATUS_RANK[normalizedRight] || 0) > (STATUS_RANK[normalizedLeft] || 0)
    ? normalizedRight
    : normalizedLeft
}

function responseBand(durationMs) {
  return RESPONSE_BANDS.find(band => durationMs < band.maximumMs)?.id ?? 'severe'
}

function percentile(values, ratio) {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1)
  return roundMilliseconds(sorted[index])
}

function parseInteractionSamples(text) {
  const envelopes = String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line))

  const pickleById = new Map()
  const testCaseById = new Map()
  const startedById = new Map()
  const resultByStartedAndStepId = new Map()

  for (const envelope of envelopes) {
    if (envelope.pickle) {
      pickleById.set(envelope.pickle.id, envelope.pickle)
    }
    if (envelope.testCase) {
      testCaseById.set(envelope.testCase.id, envelope.testCase)
    }
    if (envelope.testCaseStarted) {
      startedById.set(envelope.testCaseStarted.id, envelope.testCaseStarted)
    }
    if (envelope.testStepFinished) {
      const finished = envelope.testStepFinished
      resultByStartedAndStepId.set(
        `${finished.testCaseStartedId}:${finished.testStepId}`,
        finished.testStepResult,
      )
    }
  }

  const latestStartedByPickleId = new Map()
  for (const [startedId, started] of startedById) {
    const testCase = testCaseById.get(started.testCaseId)
    if (!testCase) {
      continue
    }
    const current = latestStartedByPickleId.get(testCase.pickleId)
    if (!current || Number(started.attempt || 0) >= Number(current.started.attempt || 0)) {
      latestStartedByPickleId.set(testCase.pickleId, { startedId, started, testCase })
    }
  }

  const interactions = []
  for (const [pickleId, execution] of latestStartedByPickleId) {
    const pickle = pickleById.get(pickleId)
    if (!pickle) {
      continue
    }
    const pickleStepById = new Map((pickle.steps || []).map(step => [step.id, step]))
    const tags = (pickle.tags || []).map(tag => tag.name)
    const stableId = tags.find(tag => tag.startsWith('@CRADLE-'))?.slice(1) ?? null
    let active = null

    const finishActive = () => {
      if (!active) {
        return
      }
      if (active.status === 'SKIPPED' && active.durationMs === 0) {
        active = null
        return
      }
      active.durationMs = roundMilliseconds(active.durationMs)
      active.band = responseBand(active.durationMs)
      interactions.push(active)
      active = null
    }

    for (const testStep of execution.testCase.testSteps || []) {
      if (!testStep.pickleStepId) {
        continue
      }
      const pickleStep = pickleStepById.get(testStep.pickleStepId)
      if (!pickleStep) {
        continue
      }
      const result = resultByStartedAndStepId.get(`${execution.startedId}:${testStep.id}`)
      const durationMs = durationMilliseconds(result?.duration)
      const status = normalizeStatus(result?.status)

      if (pickleStep.type === 'Action') {
        finishActive()
        active = {
          key: `${stableId ?? pickle.id}::${pickleStep.text}`,
          stableId,
          feature: path.basename(pickle.uri || 'unknown.feature'),
          scenario: pickle.name,
          action: pickleStep.text,
          responses: [],
          responseBoundary: 'action-step-completion',
          durationMs,
          status,
          band: 'instant',
        }
        continue
      }

      if (pickleStep.type === 'Outcome' && active) {
        active.responses.push(pickleStep.text)
        active.responseBoundary = 'gherkin-outcome'
        active.durationMs += durationMs
        active.status = worstStatus(active.status, status)
        continue
      }

      finishActive()
    }
    finishActive()
  }

  return interactions.sort(
    (left, right) =>
      left.feature.localeCompare(right.feature)
      || left.scenario.localeCompare(right.scenario)
      || left.action.localeCompare(right.action),
  )
}

function aggregateByAction(interactions) {
  const grouped = new Map()
  for (const interaction of interactions) {
    const current = grouped.get(interaction.key) || {
      key: interaction.key,
      stableId: interaction.stableId,
      action: interaction.action,
      source: interaction.source,
      samples: [],
    }
    current.samples.push(interaction.durationMs)
    grouped.set(interaction.key, current)
  }

  return Array.from(grouped.values(), group => ({
    key: group.key,
    stableId: group.stableId,
    action: group.action,
    source: group.source,
    samples: group.samples.length,
    p50Ms: percentile(group.samples, 0.5),
    p95Ms: percentile(group.samples, 0.95),
    maximumMs: roundMilliseconds(Math.max(...group.samples)),
  })).sort((left, right) => right.p95Ms - left.p95Ms || left.key.localeCompare(right.key))
}

function aggregateBySurface(interactions) {
  const grouped = new Map()
  for (const interaction of interactions) {
    const current = grouped.get(interaction.source) || []
    current.push(interaction)
    grouped.set(interaction.source, current)
  }

  return Array.from(grouped, ([source, samples]) => {
    const durations = samples.map(sample => sample.durationMs)
    return {
      source,
      interactions: samples.length,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      maximumMs: roundMilliseconds(Math.max(...durations)),
      failures: samples.filter(sample => sample.status === 'FAILED').length,
    }
  }).sort((left, right) => left.source.localeCompare(right.source))
}

function buildComparison(actionAggregates, baseline) {
  const baselineByKey = new Map(
    (baseline?.actionAggregates || []).map(action => [action.key, action]),
  )
  const matches = actionAggregates
    .filter(action => baselineByKey.has(action.key))
    .map((action) => {
      const previous = baselineByKey.get(action.key)
      const deltaMs = roundMilliseconds(action.p50Ms - previous.p50Ms)
      const deltaPercent
        = previous.p50Ms === 0 ? null : Math.round((deltaMs / previous.p50Ms) * 10_000) / 100
      return {
        key: action.key,
        stableId: action.stableId,
        action: action.action,
        baselineP50Ms: previous.p50Ms,
        currentP50Ms: action.p50Ms,
        deltaMs,
        deltaPercent,
      }
    })

  return {
    matchedActions: matches.length,
    improvements: matches
      .filter(match => match.deltaMs < 0)
      .sort((left, right) => left.deltaMs - right.deltaMs),
    regressions: matches
      .filter(match => match.deltaMs > 0)
      .sort((left, right) => right.deltaMs - left.deltaMs),
  }
}

function formatDuration(durationMs) {
  return durationMs >= 1_000
    ? `${(durationMs / 1_000).toFixed(2)} s`
    : `${Math.round(durationMs)} ms`
}

function markdownTable(rows, emptyMessage) {
  return rows.length > 0 ? rows.join('\n') : `_${emptyMessage}_`
}

function responseDescription(interaction) {
  const responses = (interaction.responses || []).join('; ')
  if (responses) {
    return responses
  }
  if (interaction.responseBoundary === 'action-step-completion') {
    return 'Action step completed (no separate Outcome)'
  }
  if (interaction.responseBoundary === 'maestro-interrupted') {
    return 'No response completed before interruption'
  }
  return 'n/a'
}

function buildPerformanceReport(input) {
  const interactions = input.interactions.map(interaction => ({
    ...interaction,
    source: interaction.source || 'web',
    durationMs: roundMilliseconds(interaction.durationMs),
    band: responseBand(interaction.durationMs),
  }))
  const durations = interactions.map(interaction => interaction.durationMs)
  const actionAggregates = aggregateByAction(interactions)
  const surfaceAggregates = aggregateBySurface(interactions)
  const bandCounts = Object.fromEntries(RESPONSE_BANDS.map(band => [band.id, 0]))
  for (const interaction of interactions) {
    bandCounts[interaction.band] += 1
  }

  const topInteractions = [...interactions]
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, 30)
  const comparison = input.baseline ? buildComparison(actionAggregates, input.baseline) : null
  const summary = {
    interactions: interactions.length,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    maximumMs: durations.length > 0 ? roundMilliseconds(Math.max(...durations)) : 0,
    bandCounts,
  }

  const topRows = topInteractions.map(
    interaction =>
      `| \`${interaction.stableId ?? 'unlabeled'}\` | \`${interaction.source}\` | ${interaction.action.replaceAll('|', '\\|')} | ${responseDescription(interaction).replaceAll('|', '\\|')} | ${formatDuration(interaction.durationMs)} | \`${interaction.band}\` | \`${interaction.status}\` |`,
  )
  const comparisonRows = (comparison?.regressions || [])
    .slice(0, 15)
    .map(
      change =>
        `| \`${change.stableId ?? 'unlabeled'}\` | ${change.action.replaceAll('|', '\\|')} | ${formatDuration(change.baselineP50Ms)} | ${formatDuration(change.currentP50Ms)} | ${change.deltaPercent === null ? 'n/a' : `${change.deltaPercent > 0 ? '+' : ''}${change.deltaPercent}%`} |`,
    )
  const surfaceRows = surfaceAggregates.map(
    surface => `| \`${surface.source}\` | ${surface.interactions} | ${formatDuration(surface.p50Ms)} | ${formatDuration(surface.p95Ms)} | ${formatDuration(surface.maximumMs)} | ${surface.failures} |`,
  )

  const markdown = [
    input.suite ? `## ${input.suite} Performance` : '## Interaction Performance',
    '',
    '| Metric | Value |',
    '| --- | ---: |',
    `| Measured interactions | ${summary.interactions} |`,
    `| P50 action-to-response | ${formatDuration(summary.p50Ms)} |`,
    `| P95 action-to-response | ${formatDuration(summary.p95Ms)} |`,
    `| Maximum action-to-response | ${formatDuration(summary.maximumMs)} |`,
    `| Instant (<100 ms) | ${bandCounts.instant} |`,
    `| Perceptible (100 ms-1 s) | ${bandCounts.perceptible} |`,
    `| Flow breaking (1-10 s) | ${bandCounts['flow-breaking']} |`,
    `| Severe wait (>=10 s) | ${bandCounts.severe} |`,
    '',
    input.measurementDescription
    || 'Each sample starts at a Gherkin `Action` step and includes every following `Outcome` step, so the duration ends only after the expected user-visible response is verified. Setup steps and runner startup are excluded.',
    '',
    '### Surface Summary',
    '',
    '| Surface | Samples | P50 | P95 | Maximum | Failures |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    markdownTable(surfaceRows, 'No interaction surfaces were recorded.'),
    '',
    '### Slowest Interactions',
    '',
    '| Scenario | Surface | Action | Response | Duration | Band | Status |',
    '| --- | --- | --- | --- | ---: | --- | --- |',
    markdownTable(topRows, 'No interaction samples were recorded.'),
    ...(comparison
      ? [
          '',
          '### Baseline Regressions',
          '',
          `Matched ${comparison.matchedActions} action definitions. Comparisons are informational because E2E timings vary with runner load.`,
          '',
          '| Scenario | Action | Baseline P50 | Current P50 | Delta |',
          '| --- | --- | ---: | ---: | ---: |',
          markdownTable(comparisonRows, 'No matched action was slower than the baseline.'),
        ]
      : []),
  ].join('\n')

  return {
    version: 1,
    suite: input.suite || '',
    tagsFilter: input.tagsFilter || '',
    runUrl: input.runUrl || '',
    thresholdsMs: {
      instant: 100,
      perceptible: 1_000,
      flowBreaking: 10_000,
    },
    summary,
    interactions,
    actionAggregates,
    surfaceAggregates,
    comparison,
    markdown,
  }
}

module.exports = {
  RESPONSE_BANDS,
  buildPerformanceReport,
  parseInteractionSamples,
}
