const assert = require('node:assert/strict')
const test = require('node:test')

const { buildPerformanceReport, parseInteractionSamples } = require('./performance-report.cjs')

function envelopeLines(...envelopes) {
  return envelopes.map(envelope => JSON.stringify(envelope)).join('\n')
}

function duration(milliseconds) {
  return {
    seconds: Math.floor(milliseconds / 1_000),
    nanos: (milliseconds % 1_000) * 1_000_000,
  }
}

const discoveryEnvelopes = [
  {
    pickle: {
      id: 'pickle-1',
      uri: 'e2e/src/features/settings.feature',
      name: 'theme persists',
      tags: [{ name: '@P1' }, { name: '@CRADLE-SETTINGS-001' }],
      steps: [
        { id: 'setup', text: 'app launched', type: 'Context' },
        { id: 'action-1', text: 'select dark theme', type: 'Action' },
        { id: 'outcome-1', text: 'dark theme is selected', type: 'Outcome' },
        { id: 'outcome-2', text: 'document uses dark theme', type: 'Outcome' },
        { id: 'action-2', text: 'reload the page', type: 'Action' },
      ],
    },
  },
  {
    testCase: {
      id: 'case-1',
      pickleId: 'pickle-1',
      testSteps: [
        { id: 'hook-before', hookId: 'hook-1' },
        { id: 'test-setup', pickleStepId: 'setup' },
        { id: 'test-action-1', pickleStepId: 'action-1' },
        { id: 'test-outcome-1', pickleStepId: 'outcome-1' },
        { id: 'test-outcome-2', pickleStepId: 'outcome-2' },
        { id: 'test-action-2', pickleStepId: 'action-2' },
        { id: 'hook-after', hookId: 'hook-2' },
      ],
    },
  },
]

function executionEnvelopes(startedId, attempt, milliseconds) {
  return [
    { testCaseStarted: { id: startedId, testCaseId: 'case-1', attempt } },
    {
      testStepFinished: {
        testCaseStartedId: startedId,
        testStepId: 'hook-before',
        testStepResult: { status: 'PASSED', duration: duration(900) },
      },
    },
    ...[
      ['test-setup', 800],
      ['test-action-1', milliseconds.action],
      ['test-outcome-1', milliseconds.outcome1],
      ['test-outcome-2', milliseconds.outcome2],
      ['test-action-2', milliseconds.reload],
    ].map(([testStepId, value]) => ({
      testStepFinished: {
        testCaseStartedId: startedId,
        testStepId,
        testStepResult: { status: 'PASSED', duration: duration(value) },
      },
    })),
    {
      testStepFinished: {
        testCaseStartedId: startedId,
        testStepId: 'hook-after',
        testStepResult: { status: 'PASSED', duration: duration(700) },
      },
    },
  ]
}

test('measures each action through its following outcomes and excludes setup and hooks', () => {
  const interactions = parseInteractionSamples(
    envelopeLines(
      ...discoveryEnvelopes,
      ...executionEnvelopes('started-1', 0, {
        action: 40,
        outcome1: 80,
        outcome2: 30,
        reload: 1_200,
      }),
    ),
  )

  assert.deepEqual(interactions, [
    {
      key: 'CRADLE-SETTINGS-001::reload the page',
      stableId: 'CRADLE-SETTINGS-001',
      feature: 'settings.feature',
      scenario: 'theme persists',
      action: 'reload the page',
      responses: [],
      durationMs: 1_200,
      status: 'PASSED',
      band: 'flow-breaking',
    },
    {
      key: 'CRADLE-SETTINGS-001::select dark theme',
      stableId: 'CRADLE-SETTINGS-001',
      feature: 'settings.feature',
      scenario: 'theme persists',
      action: 'select dark theme',
      responses: ['dark theme is selected', 'document uses dark theme'],
      durationMs: 150,
      status: 'PASSED',
      band: 'perceptible',
    },
  ])
})

test('uses only the latest retry attempt', () => {
  const interactions = parseInteractionSamples(
    envelopeLines(
      ...discoveryEnvelopes,
      ...executionEnvelopes('started-1', 0, {
        action: 2_000,
        outcome1: 1_000,
        outcome2: 500,
        reload: 3_000,
      }),
      ...executionEnvelopes('started-2', 1, {
        action: 20,
        outcome1: 30,
        outcome2: 40,
        reload: 50,
      }),
    ),
  )

  assert.equal(interactions.length, 2)
  assert.equal(interactions.find(item => item.action === 'select dark theme').durationMs, 90)
  assert.equal(interactions.find(item => item.action === 'reload the page').durationMs, 50)
})

test('excludes skipped actions that never occurred', () => {
  const messages = [
    ...discoveryEnvelopes,
    ...executionEnvelopes('started-1', 0, {
      action: 40,
      outcome1: 80,
      outcome2: 30,
      reload: 0,
    }),
  ]
  const reloadResult = messages.find(envelope =>
    envelope.testStepFinished?.testStepId === 'test-action-2')
  reloadResult.testStepFinished.testStepResult.status = 'SKIPPED'

  const interactions = parseInteractionSamples(envelopeLines(...messages))

  assert.equal(interactions.length, 1)
  assert.equal(interactions[0].action, 'select dark theme')
})

test('retains failed interactions so timeout-heavy paths stay visible', () => {
  const messages = [
    ...discoveryEnvelopes,
    ...executionEnvelopes('started-1', 0, {
      action: 40,
      outcome1: 30_000,
      outcome2: 20,
      reload: 0,
    }),
  ]
  const failedOutcome = messages.find(envelope =>
    envelope.testStepFinished?.testStepId === 'test-outcome-1')
  failedOutcome.testStepFinished.testStepResult.status = 'FAILED'

  const interactions = parseInteractionSamples(envelopeLines(...messages))
  const failedInteraction = interactions.find(item => item.action === 'select dark theme')

  assert.equal(failedInteraction.durationMs, 30_060)
  assert.equal(failedInteraction.status, 'FAILED')
  assert.equal(failedInteraction.band, 'severe')
})

test('summarizes response bands and reports informational baseline changes', () => {
  const interactions = [
    {
      key: 'A::instant',
      stableId: 'A',
      action: 'instant',
      durationMs: 99,
      band: 'instant',
      status: 'PASSED',
    },
    {
      key: 'A::perceptible',
      stableId: 'A',
      action: 'perceptible',
      durationMs: 100,
      band: 'perceptible',
      status: 'PASSED',
    },
    {
      key: 'A::flow',
      stableId: 'A',
      action: 'flow',
      durationMs: 1_000,
      band: 'flow-breaking',
      status: 'PASSED',
    },
    {
      key: 'A::severe',
      stableId: 'A',
      action: 'severe',
      durationMs: 10_000,
      band: 'severe',
      status: 'PASSED',
    },
  ]
  const baseline = buildPerformanceReport({
    interactions: interactions.map(interaction => ({
      ...interaction,
      durationMs: interaction.durationMs / 2,
    })),
  })
  const report = buildPerformanceReport({ interactions, baseline, tagsFilter: '@P1' })

  assert.deepEqual(report.summary.bandCounts, {
    'instant': 1,
    'perceptible': 1,
    'flow-breaking': 1,
    'severe': 1,
  })
  assert.equal(report.comparison.matchedActions, 4)
  assert.equal(report.comparison.regressions.length, 4)
  assert.match(report.markdown, /Comparisons are informational/)
  assert.match(report.markdown, /P95 action-to-response/)
})
