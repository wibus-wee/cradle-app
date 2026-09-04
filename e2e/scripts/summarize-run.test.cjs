const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const { buildRunSummary, parseMessagesText, summarizeRun } = require('./summarize-run.cjs')

function envelopeLines(...envelopes) {
  return envelopes.map(envelope => JSON.stringify(envelope)).join('\n')
}

const discoveryEnvelopes = [
  {
    gherkinDocument: {
      uri: 'e2e/src/features/chat.feature',
      feature: {
        name: 'Chat',
        children: [{ scenario: { id: 'ast-1', name: 'recovers', location: { line: 42 } } }],
      },
    },
  },
  {
    pickle: {
      id: 'pickle-1',
      uri: 'e2e/src/features/chat.feature',
      name: 'recovers',
      astNodeIds: ['ast-1'],
      tags: [{ name: '@P0' }, { name: '@CRADLE-CHAT-001' }],
    },
  },
  { testCase: { id: 'case-1', pickleId: 'pickle-1' } },
]

test('parses the latest retry attempt from structured Cucumber messages', () => {
  const scenarios = parseMessagesText(envelopeLines(
    ...discoveryEnvelopes,
    { testCaseStarted: { id: 'started-1', testCaseId: 'case-1', attempt: 0 } },
    {
      testStepFinished: {
        testCaseStartedId: 'started-1',
        testStepResult: { status: 'FAILED', message: 'first attempt failed\nstack' },
      },
    },
    { testCaseStarted: { id: 'started-2', testCaseId: 'case-1', attempt: 1 } },
    {
      testStepFinished: {
        testCaseStartedId: 'started-2',
        testStepResult: { status: 'PASSED' },
      },
    },
  ))

  assert.deepEqual(scenarios, [{
    feature: 'chat.feature',
    line: 42,
    name: 'recovers',
    tags: '@P0 @CRADLE-CHAT-001',
    status: 'PASSED',
    error: '',
  }])
})

test('reports failed scenarios with stable location, tags, and first error line', () => {
  const scenarios = parseMessagesText(envelopeLines(
    ...discoveryEnvelopes,
    { testCaseStarted: { id: 'started-1', testCaseId: 'case-1', attempt: 0 } },
    {
      testStepFinished: {
        testCaseStartedId: 'started-1',
        testStepResult: { status: 'FAILED', message: 'provider disconnected\nstack' },
      },
    },
  ))
  const summary = buildRunSummary({
    scenarios,
    outcome: 'failure',
    tagsFilter: '@P0',
    runUrl: 'https://example.test/run',
    rawSummary: '',
    outputTail: '',
    parseError: '',
  })

  assert.equal(summary.resultLine, '1 failed / 1 total (0 passed)')
  assert.match(summary.markdown, /chat\.feature:42/)
  assert.match(summary.markdown, /@CRADLE-CHAT-001/)
  assert.match(summary.markdown, /provider disconnected/)
})

test('preserves raw diagnostics when Cucumber fails before a scenario starts', () => {
  const summary = buildRunSummary({
    scenarios: [],
    outcome: 'failure',
    tagsFilter: '@P0',
    runUrl: 'https://example.test/run',
    rawSummary: 'BeforeAll failed',
    outputTail: 'server failed to boot',
    parseError: 'message parse error: truncated JSON',
  })

  assert.match(summary.markdown, /failed before any scenario result/)
  assert.match(summary.markdown, /BeforeAll failed/)
  assert.match(summary.markdown, /server failed to boot/)
  assert.deepEqual(summary.parseErrors, ['message parse error: truncated JSON'])
})

test('writes machine-readable and human-readable interaction reports with the run summary', (t) => {
  const artifactsDir = mkdtempSync(join(tmpdir(), 'cradle-e2e-summary-'))
  t.after(() => rmSync(artifactsDir, { force: true, recursive: true }))
  const envelopes = [
    discoveryEnvelopes[0],
    {
      pickle: {
        ...discoveryEnvelopes[1].pickle,
        steps: [
          { id: 'action-1', text: 'open settings', type: 'Action' },
          { id: 'outcome-1', text: 'settings are visible', type: 'Outcome' },
        ],
      },
    },
    {
      testCase: {
        id: 'case-1',
        pickleId: 'pickle-1',
        testSteps: [
          { id: 'test-action-1', pickleStepId: 'action-1' },
          { id: 'test-outcome-1', pickleStepId: 'outcome-1' },
        ],
      },
    },
    { testCaseStarted: { id: 'started-1', testCaseId: 'case-1', attempt: 0 } },
    {
      testStepFinished: {
        testCaseStartedId: 'started-1',
        testStepId: 'test-action-1',
        testStepResult: { status: 'PASSED', duration: { seconds: 0, nanos: 40_000_000 } },
      },
    },
    {
      testStepFinished: {
        testCaseStartedId: 'started-1',
        testStepId: 'test-outcome-1',
        testStepResult: { status: 'PASSED', duration: { seconds: 0, nanos: 70_000_000 } },
      },
    },
  ]
  writeFileSync(join(artifactsDir, 'cucumber-messages.ndjson'), envelopeLines(...envelopes))

  const result = summarizeRun({ artifactsDir, outcome: 'success', tagsFilter: '@P0' })
  const performance = JSON.parse(readFileSync(join(artifactsDir, 'e2e-performance.json'), 'utf8'))

  assert.equal(result.totalScenarios, 1)
  assert.equal(result.performance.summary.interactions, 1)
  assert.equal(performance.interactions[0].durationMs, 110)
  assert.match(readFileSync(join(artifactsDir, 'e2e-performance.md'), 'utf8'), /open settings/)
})

test('rejects a successful run without structured interaction evidence', (t) => {
  const artifactsDir = mkdtempSync(join(tmpdir(), 'cradle-e2e-summary-empty-'))
  t.after(() => rmSync(artifactsDir, { force: true, recursive: true }))

  assert.throws(
    () => summarizeRun({ artifactsDir, outcome: 'success', tagsFilter: '@P0' }),
    /did not produce cucumber-messages\.ndjson/,
  )
  assert.equal(JSON.parse(readFileSync(join(artifactsDir, 'e2e-performance.json'), 'utf8')).summary.interactions, 0)
})
