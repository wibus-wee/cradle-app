const assert = require('node:assert/strict')
const test = require('node:test')

const { buildDailyFailureIssueBody } = require('./format-failure-issue.cjs')

test('uses the runtime-lane artifact name throughout a daily failure issue', () => {
  const artifactName = 'e2e-codex-artifacts-123'
  const body = buildDailyFailureIssueBody({
    today: '2026-08-31',
    branch: 'main',
    tagsFilter: '@P0 and @runtime-codex',
    runId: '123',
    runUrl: 'https://example.test/runs/123',
    artifactsUrl: 'https://example.test/runs/123',
    artifactName,
    summary: {
      resultLine: '1 failed / 1 total (0 passed)',
      nonPassedScenarios: [],
      markdown: 'failed',
    },
    failureIndex: [],
  })

  assert.equal(body.match(new RegExp(artifactName, 'g'))?.length, 3)
  assert.doesNotMatch(body, /name: e2e-artifacts-123/)
})
