const assert = require('node:assert/strict')
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const PlaywrightPerformanceReporter = require('./playwright-performance-reporter.cjs')

const { sampleFromStep } = PlaywrightPerformanceReporter

test('maps only explicit Playwright interaction steps into performance samples', () => {
  const testCase = {
    id: 'fabric-test',
    title: '[CRADLE-FABRIC-001] pairs two Nodes',
    location: { file: '/repo/e2e/src/fabric/fabric-two-node.spec.ts' },
  }

  assert.equal(sampleFromStep(testCase, {
    category: 'test.step',
    title: 'setup topology',
    duration: 900,
  }), null)
  assert.deepEqual(sampleFromStep(testCase, {
    category: 'test.step',
    title: '[interaction:fabric-web] approve Node pairing request [response: both Nodes are online]',
    duration: 1_250.4321,
  }), {
    key: 'CRADLE-FABRIC-001::approve Node pairing request',
    stableId: 'CRADLE-FABRIC-001',
    feature: 'fabric-two-node.spec.ts',
    scenario: '[CRADLE-FABRIC-001] pairs two Nodes',
    action: 'approve Node pairing request',
    responses: ['both Nodes are online'],
    responseBoundary: 'playwright-assertion',
    source: 'fabric-web',
    durationMs: 1_250.4321,
    status: 'PASSED',
  })

  assert.throws(() => sampleFromStep(testCase, {
    category: 'test.step',
    title: '[interaction:fabric-web] missing a response description',
    duration: 10,
  }), /must include an explicit/)
})

test('writes passed and failed Playwright interactions through the shared report model', (t) => {
  const outputDir = mkdtempSync(join(tmpdir(), 'cradle-fabric-performance-'))
  t.after(() => rmSync(outputDir, { force: true, recursive: true }))
  const reporter = new PlaywrightPerformanceReporter({ outputDir })
  const testCase = {
    id: 'fabric-test',
    title: '[CRADLE-FABRIC-002] controls Nodes from Mobile',
    location: { file: '/repo/e2e/src/fabric/fabric-two-node.spec.ts' },
  }

  reporter.onStepEnd(testCase, {}, {
    category: 'test.step',
    title: '[interaction:fabric-web] send Chat [response: the streamed response is visible]',
    duration: 31_000,
    error: new Error('timed out'),
  })
  reporter.onEnd()

  const report = JSON.parse(readFileSync(join(outputDir, 'e2e-performance.json'), 'utf8'))
  assert.equal(report.summary.interactions, 1)
  assert.equal(report.interactions[0].source, 'fabric-web')
  assert.deepEqual(report.interactions[0].responses, ['the streamed response is visible'])
  assert.equal(report.interactions[0].responseBoundary, 'playwright-assertion')
  assert.equal(report.interactions[0].status, 'FAILED')
  assert.equal(report.interactions[0].band, 'severe')
  assert.match(readFileSync(join(outputDir, 'e2e-performance.md'), 'utf8'), /the streamed response is visible/)
})

test('merges labeled Maestro command timings into the Mobile report', (t) => {
  const outputDir = mkdtempSync(join(tmpdir(), 'cradle-fabric-performance-'))
  const maestroRoot = mkdtempSync(join(tmpdir(), 'cradle-maestro-artifacts-'))
  const commandsDir = join(maestroRoot, 'select-node', 'tests', 'run-1', 'select-node')
  mkdirSync(commandsDir, { recursive: true })
  writeFileSync(join(commandsDir, 'commands.json'), JSON.stringify([
    {
      metadata: {
        duration: 200,
        evaluatedCommand: {
          tapOnElement: { label: 'perf-action:select-node|select a Node' },
        },
        sequenceNumber: 0,
        status: 'COMPLETED',
        timestamp: 1_000,
      },
    },
    {
      metadata: {
        duration: 300,
        evaluatedCommand: {
          assertConditionCommand: { label: 'perf-response:select-node|Node Workspaces are visible' },
        },
        sequenceNumber: 1,
        status: 'COMPLETED',
        timestamp: 1_200,
      },
    },
  ]))
  const previousMobile = process.env.CRADLE_E2E_MOBILE_IOS
  const previousArtifacts = process.env.CRADLE_E2E_MOBILE_ARTIFACTS_DIR
  process.env.CRADLE_E2E_MOBILE_IOS = '1'
  process.env.CRADLE_E2E_MOBILE_ARTIFACTS_DIR = maestroRoot
  t.after(() => {
    if (previousMobile === undefined) {
      delete process.env.CRADLE_E2E_MOBILE_IOS
    }
    else {
      process.env.CRADLE_E2E_MOBILE_IOS = previousMobile
    }
    if (previousArtifacts === undefined) {
      delete process.env.CRADLE_E2E_MOBILE_ARTIFACTS_DIR
    }
    else {
      process.env.CRADLE_E2E_MOBILE_ARTIFACTS_DIR = previousArtifacts
    }
    rmSync(outputDir, { force: true, recursive: true })
    rmSync(maestroRoot, { force: true, recursive: true })
  })

  const reporter = new PlaywrightPerformanceReporter({ outputDir })
  reporter.onEnd()

  const report = JSON.parse(readFileSync(join(outputDir, 'e2e-performance.json'), 'utf8'))
  assert.equal(report.summary.interactions, 1)
  assert.equal(report.interactions[0].scenario, 'select-node')
  assert.equal(report.interactions[0].durationMs, 500)
  assert.equal(report.interactions[0].source, 'mobile-ios')
  assert.equal(report.interactions[0].responseBoundary, 'maestro-visible-assertion')
})
