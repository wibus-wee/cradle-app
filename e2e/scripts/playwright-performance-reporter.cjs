const fs = require('node:fs')
const path = require('node:path')

const { loadMaestroInteractionSamples } = require('./maestro-performance.cjs')
const { buildPerformanceReport } = require('./performance-report.cjs')

const INTERACTION_STEP = /^\[interaction:([^\]]+)\]\s+(.+?)\s+\[response:\s*(.+)\]$/

function maintainedMaestroFlows() {
  const flowsDir = path.join(__dirname, '..', 'mobile', 'maestro')
  return fs.readdirSync(flowsDir)
    .filter(name => name.endsWith('.yaml'))
    .map(name => path.basename(name, '.yaml'))
    .sort()
}

function sampleFromStep(testCase, step) {
  if (step.category !== 'test.step') {
    return null
  }
  const match = INTERACTION_STEP.exec(step.title)
  if (!match) {
    if (step.title.startsWith('[interaction:')) {
      throw new Error(`Interaction step must include an explicit [response: ...] boundary: ${step.title}`)
    }
    return null
  }

  const stableId = testCase.title.match(/\[(CRADLE-[A-Z0-9-]+-\d{3})\]/)?.[1] ?? null
  const action = match[2]
  return {
    key: `${stableId ?? testCase.id}::${action}`,
    stableId,
    feature: path.basename(testCase.location?.file || 'unknown.spec.ts'),
    scenario: testCase.title,
    action,
    responses: [match[3]],
    responseBoundary: 'playwright-assertion',
    source: match[1],
    durationMs: step.duration,
    status: step.error ? 'FAILED' : 'PASSED',
  }
}

class PlaywrightPerformanceReporter {
  constructor(options = {}) {
    this.options = options
    this.interactions = []
  }

  onStepEnd(testCase, _result, step) {
    const sample = sampleFromStep(testCase, step)
    if (sample) {
      this.interactions.push(sample)
    }
  }

  onEnd(result) {
    const outputDir = path.resolve(
      __dirname,
      '..',
      this.options.outputDir || 'artifacts/fabric-results/performance',
    )
    const baselinePath = process.env.E2E_FABRIC_PERFORMANCE_BASELINE
    let baseline = null
    if (baselinePath) {
      baseline = JSON.parse(fs.readFileSync(path.resolve(baselinePath), 'utf8'))
    }
    const mobile = process.env.CRADLE_E2E_MOBILE_IOS === '1'
    const interactions = [...this.interactions]
    let instrumentationError = null
    if (mobile) {
      const maestroArtifacts = process.env.CRADLE_E2E_MOBILE_ARTIFACTS_DIR?.trim()
      if (!maestroArtifacts) {
        throw new Error('CRADLE_E2E_MOBILE_ARTIFACTS_DIR is required for Mobile performance reporting.')
      }
      const mobileInteractions = loadMaestroInteractionSamples(maestroArtifacts)
      interactions.push(...mobileInteractions)
      if (result?.status === 'passed') {
        const recordedFlows = new Set(mobileInteractions.map(interaction => interaction.scenario))
        const missingFlows = maintainedMaestroFlows().filter(flow => !recordedFlows.has(flow))
        if (missingFlows.length > 0) {
          instrumentationError = new Error(
            `Successful Mobile Fabric run did not record interaction samples for: ${missingFlows.join(', ')}.`,
          )
        }
      }
    }
    else if (result?.status === 'passed' && interactions.length === 0) {
      instrumentationError = new Error('Successful Fabric Web run did not record any user interactions.')
    }
    const report = buildPerformanceReport({
      interactions,
      suite: mobile ? 'Fabric Mobile iOS Interaction' : 'Fabric Two-Node Interaction',
      tagsFilter: mobile ? 'CRADLE-FABRIC-002' : 'CRADLE-FABRIC-001',
      runUrl: process.env.RUN_URL || '',
      baseline,
      measurementDescription: mobile
        ? 'Web samples are explicit Playwright interaction steps. Mobile samples use labeled Maestro commands and span one launch, tap, or text entry through its paired visible response. Fixtures, build time, topology startup, and unselected conditional branches are excluded.'
        : 'Each sample is an explicit Playwright interaction step that starts with a Web user operation and ends after its asserted visible, persisted, remote, or streamed response. Fixtures and topology startup are excluded.',
    })

    fs.mkdirSync(outputDir, { recursive: true })
    fs.writeFileSync(
      path.join(outputDir, 'e2e-performance.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    )
    fs.writeFileSync(path.join(outputDir, 'e2e-performance.md'), `${report.markdown}\n`)
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report.markdown}\n`)
    }
    if (instrumentationError) {
      throw instrumentationError
    }
  }

  printsToStdio() {
    return false
  }
}

module.exports = PlaywrightPerformanceReporter
module.exports.INTERACTION_STEP = INTERACTION_STEP
module.exports.sampleFromStep = sampleFromStep
