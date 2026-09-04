const fs = require('node:fs')
const path = require('node:path')

const { buildPerformanceReport, parseInteractionSamples } = require('./performance-report.cjs')

const STATUS_RANK = {
  UNKNOWN: 0,
  PASSED: 1,
  SKIPPED: 2,
  PENDING: 3,
  UNDEFINED: 4,
  AMBIGUOUS: 5,
  FAILED: 6,
}

function firstLine(value) {
  return String(value || '').split(/\r?\n/).find(Boolean) || ''
}

function normalizeStatus(status) {
  return String(status || '').toUpperCase()
}

function collectScenarioNodes(children, uri, featureName, out) {
  for (const child of children || []) {
    if (child.scenario?.id) {
      const scenario = child.scenario
      out.set(scenario.id, {
        feature: path.basename(uri || 'unknown.feature'),
        featureName,
        line: scenario.location?.line,
        name: scenario.name,
      })
    }
    if (child.rule) {
      collectScenarioNodes(child.rule.children, uri, featureName, out)
    }
  }
}

function parseMessagesText(text) {
  const envelopes = String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line))

  const scenarioByAstId = new Map()
  const pickleById = new Map()
  const testCaseById = new Map()
  const startedById = new Map()
  const resultByStartedId = new Map()

  for (const envelope of envelopes) {
    if (envelope.gherkinDocument) {
      const document = envelope.gherkinDocument
      collectScenarioNodes(
        document.feature?.children,
        document.uri,
        document.feature?.name || path.basename(document.uri || 'unknown.feature'),
        scenarioByAstId,
      )
    }
    if (envelope.pickle) {
      pickleById.set(envelope.pickle.id, envelope.pickle)
    }
    if (envelope.testCase) {
      testCaseById.set(envelope.testCase.id, envelope.testCase)
    }
    if (envelope.testCaseStarted) {
      startedById.set(envelope.testCaseStarted.id, {
        testCaseId: envelope.testCaseStarted.testCaseId,
        attempt: envelope.testCaseStarted.attempt || 0,
      })
    }
    if (envelope.testStepFinished) {
      const finished = envelope.testStepFinished
      const existing = resultByStartedId.get(finished.testCaseStartedId) || {
        status: 'PASSED',
        error: '',
      }
      const status = normalizeStatus(finished.testStepResult?.status)
      if ((STATUS_RANK[status] || 0) > (STATUS_RANK[existing.status] || 0)) {
        existing.status = status
      }
      if (!existing.error && status === 'FAILED') {
        existing.error = firstLine(finished.testStepResult?.message)
      }
      resultByStartedId.set(finished.testCaseStartedId, existing)
    }
  }

  const latestByPickleId = new Map()
  for (const [startedId, started] of startedById) {
    const testCase = testCaseById.get(started.testCaseId)
    if (!testCase) {
      continue
    }
    const current = latestByPickleId.get(testCase.pickleId)
    if (!current || started.attempt >= current.attempt) {
      latestByPickleId.set(testCase.pickleId, {
        attempt: started.attempt,
        result: resultByStartedId.get(startedId) || { status: 'UNKNOWN', error: '' },
      })
    }
  }

  const scenarios = []
  for (const [pickleId, latest] of latestByPickleId) {
    const pickle = pickleById.get(pickleId)
    if (!pickle) {
      continue
    }
    const ast = (pickle.astNodeIds || [])
      .map(id => scenarioByAstId.get(id))
      .find(Boolean)
    scenarios.push({
      feature: ast?.feature || path.basename(pickle.uri || 'unknown.feature'),
      line: ast?.line,
      name: pickle.name,
      tags: (pickle.tags || []).map(tag => tag.name).join(' '),
      status: latest.result.status,
      error: latest.result.error,
    })
  }

  return scenarios.sort((left, right) =>
    left.feature.localeCompare(right.feature)
    || (left.line || 0) - (right.line || 0)
    || left.name.localeCompare(right.name))
}

function buildRunSummary(input) {
  const scenarios = input.scenarios
  const failedScenarios = scenarios.filter(scenario => scenario.status === 'FAILED')
  const passedScenarios = scenarios.filter(scenario => scenario.status === 'PASSED')
  const nonPassedScenarios = scenarios.filter(scenario => scenario.status !== 'PASSED')
  const resultLine = `${failedScenarios.length} failed / ${scenarios.length} total (${passedScenarios.length} passed)`
  const scenarioLines = nonPassedScenarios.slice(0, 30).map((scenario) => {
    const location = scenario.line ? `${scenario.feature}:${scenario.line}` : scenario.feature
    const tags = scenario.tags ? `\n  > Tags: \`${scenario.tags}\`` : ''
    const error = scenario.error ? `\n  > ${scenario.error.slice(0, 300)}` : ''
    return `- [ ] **${location}** - ${scenario.name}${tags}${error}`
  })
  const fallback = input.outcome === 'failure' && scenarios.length === 0
    ? [
        '- The Cucumber process failed before any scenario result could be parsed.',
        input.rawSummary ? `\n\`\`\`text\n${input.rawSummary.slice(0, 4000)}\n\`\`\`` : '',
        input.outputTail
          ? `\n<details><summary>Last 80 log lines</summary>\n\n\`\`\`text\n${input.outputTail.slice(-8000)}\n\`\`\`\n</details>`
          : '',
      ].join('\n')
    : ''
  const markdown = [
    '## E2E Result',
    '',
    '| Field | Value |',
    '|-------|-------|',
    `| Outcome | \`${input.outcome}\` |`,
    `| Tags filter | \`${input.tagsFilter}\` |`,
    `| Result | ${resultLine} |`,
    `| Run | [View run](${input.runUrl}) |`,
    '',
    '## Failed Scenarios',
    '',
    scenarioLines.length > 0
      ? scenarioLines.join('\n')
      : (fallback || '_No failed scenario details were parsed._'),
    input.parseError ? `\n> Parser note: ${input.parseError}` : '',
  ].join('\n')

  return {
    outcome: input.outcome,
    tagsFilter: input.tagsFilter,
    totalScenarios: scenarios.length,
    passedScenarios: passedScenarios.length,
    failedScenarios,
    nonPassedScenarios,
    resultLine,
    markdown,
    parseErrors: input.parseError ? [input.parseError] : [],
  }
}

function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : ''
}

function summarizeRun(options = {}) {
  const artifactsDir = options.artifactsDir || path.join('e2e', 'artifacts')
  const outcome = options.outcome || process.env.E2E_OUTCOME || 'unknown'
  fs.mkdirSync(artifactsDir, { recursive: true })
  const messagesPath = path.join(artifactsDir, 'cucumber-messages.ndjson')
  let scenarios = []
  let parseError = ''
  const messagesText = readText(messagesPath)
  let interactions = []
  try {
    scenarios = parseMessagesText(messagesText)
    interactions = parseInteractionSamples(messagesText)
  }
  catch (error) {
    parseError = `message parse error: ${error instanceof Error ? error.message : String(error)}`
  }
  const output = readText(path.join(artifactsDir, 'cucumber-output.log'))
  let baseline = null
  const baselinePath = options.performanceBaseline || process.env.E2E_PERFORMANCE_BASELINE
  if (baselinePath) {
    try {
      baseline = JSON.parse(readText(baselinePath))
    }
    catch (error) {
      parseError = [parseError, `performance baseline parse error: ${error instanceof Error ? error.message : String(error)}`]
        .filter(Boolean)
        .join('; ')
    }
  }
  const performance = buildPerformanceReport({
    interactions,
    suite: 'Cucumber Interaction',
    tagsFilter: options.tagsFilter || process.env.TAGS_FILTER || '',
    runUrl: options.runUrl || process.env.RUN_URL || '',
    baseline,
  })
  const summary = buildRunSummary({
    scenarios,
    outcome,
    tagsFilter: options.tagsFilter || process.env.TAGS_FILTER || '',
    runUrl: options.runUrl || process.env.RUN_URL || '',
    rawSummary: readText(path.join(artifactsDir, 'cucumber-summary.txt')),
    outputTail: output.split(/\r?\n/).slice(-80).join('\n'),
    parseError,
  })

  fs.writeFileSync(
    path.join(artifactsDir, 'e2e-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  )
  fs.writeFileSync(path.join(artifactsDir, 'e2e-summary.md'), `${summary.markdown}\n`)
  fs.writeFileSync(
    path.join(artifactsDir, 'e2e-performance.json'),
    `${JSON.stringify(performance, null, 2)}\n`,
  )
  fs.writeFileSync(path.join(artifactsDir, 'e2e-performance.md'), `${performance.markdown}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.markdown}\n\n${performance.markdown}\n`)
  }
  if (outcome === 'success') {
    if (!messagesText) {
      throw new Error('Successful E2E run did not produce cucumber-messages.ndjson for interaction performance reporting.')
    }
    if (parseError) {
      throw new Error(`Successful E2E run produced invalid performance evidence: ${parseError}`)
    }
    if (scenarios.length === 0) {
      throw new Error('Successful E2E run did not contain any parsed scenarios.')
    }
    if (interactions.length === 0) {
      throw new Error('Successful E2E run did not contain any measured user interactions.')
    }
  }
  return { ...summary, performance }
}

if (require.main === module) {
  summarizeRun()
}

module.exports = {
  buildRunSummary,
  parseMessagesText,
  summarizeRun,
}
