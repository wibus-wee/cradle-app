/**
 * Shared helpers for formatting Cradle E2E failure GitHub Issue / PR comment bodies.
 * Used by e2e-daily.yml and e2e-smoke.yml via github-script (CommonJS require).
 */

function readJson(path, fallback) {
  const fs = require('node:fs')
  if (!fs.existsSync(path)) {
    return fallback
  }
  return JSON.parse(fs.readFileSync(path, 'utf8'))
}

function formatFailureArtifactsSection(failureIndex) {
  if (!Array.isArray(failureIndex) || failureIndex.length === 0) {
    return `_No per-scenario artifact index was written. Download the run artifact and inspect \`scenarios/\` + \`ARTIFACTS.md\`._`
  }

  return failureIndex.map((entry, i) => {
    const n = i + 1
    return `### ${n}. ${entry.scenario}

| Artifact | Path inside CI zip | Purpose |
|----------|--------------------|---------|
| Screenshot | \`${entry.screenshot}\` | UI at the failing step |
| Video (1:1) | \`${entry.video}\` | Full Chromium recording of the scenario |
| Playwright Trace | \`${entry.trace}\` | DOM/network/source timeline — \`npx playwright show-trace ${entry.trace}\` |
| Console + simulator ledger | \`${entry.console}\` | Renderer errors and model-api-simulator wire log |

Folder: \`${entry.relativeDir}/\`
`
  }).join('\n')
}

function buildDailyFailureIssueBody(input) {
  const {
    today,
    branch,
    tagsFilter,
    runId,
    runUrl,
    artifactsUrl,
    artifactName,
    summary,
    failureIndex,
  } = input

  const failedList = (summary.nonPassedScenarios || []).map(s =>
    `- [ ] **${s.line ? `${s.feature}:${s.line}` : s.feature}** — ${s.name}\n  - Status: \`${s.status}\`\n  - Tags: \`${s.tags || 'none'}\`\n  - Error: ${s.error || '(no error message)'}`).join('\n')

  const agentPrompt = (summary.nonPassedScenarios || []).map(s =>
    `- ${s.name} (${s.line ? `${s.feature}:${s.line}` : s.feature}${s.tags ? ` ${s.tags}` : ''})`).join('\n')

  return `## Daily E2E Failed — ${today}

| Field | Value |
|-------|-------|
| Date | ${today} |
| Branch | \`${branch}\` |
| Tags | \`${tagsFilter}\` |
| Result | ❌ ${summary.resultLine || 'unknown'} |
| Run | [Actions run #${runId}](${runUrl}) |
| Artifacts | [Download \`${artifactName}\`](${artifactsUrl}/artifacts) |
| Assignee | @wibus-wee |

## Failed scenarios

${(summary.nonPassedScenarios || []).length > 0 ? failedList : (summary.markdown || '_No scenario details_')}

## How to reproduce from artifacts

1. Open the Actions run → **Artifacts** → download \`${artifactName}\`.
2. Read root \`ARTIFACTS.md\` (legend for every file type).
3. For each failure below: watch \`failure.webm\` first, then open \`failure.png\`, then \`npx playwright show-trace …/trace.zip\` if you need DOM/network detail.
4. Local replay: from repo root, \`pnpm exec cucumber-js --config e2e/cucumber.mjs --tags '@CRADLE-…'\` (use the scenario tag from the list).

## Per-scenario evidence

${formatFailureArtifactsSection(failureIndex)}

## Artifact bundle contents

| Path | Description |
|------|-------------|
| \`ARTIFACTS.md\` | This legend (also in the zip) |
| \`failure-index.json\` | Machine index of failures → relative paths |
| \`e2e-summary.md\` / \`e2e-summary.json\` | Run-level Cucumber summary |
| \`e2e-performance.md\` / \`e2e-performance.json\` | Per-interaction action-to-response timings and slow-path ranking |
| \`cucumber-output.log\` | Full runner stdout/stderr |
| \`cucumber-junit.xml\` | JUnit for dashboards |
| \`scenarios/<slug>-<n>/failure.webm\` | 1:1 scenario video (**CI upload only**, not embedded in Cucumber HTML) |
| \`scenarios/<slug>-<n>/failure.png\` | Failure screenshot |
| \`scenarios/<slug>-<n>/trace.zip\` | Playwright trace |
| \`scenarios/<slug>-<n>/console.log\` | Console + simulator request ledger |

---

<details>
<summary>Agent delegation prompt</summary>

\`\`\`
Cradle daily E2E failed (${today}, branch: ${branch}, tags: ${tagsFilter}).

Failures:
${agentPrompt || '(see run logs)'}

Run: ${runUrl}
Artifacts zip: ${artifactsUrl}/artifacts  (name: ${artifactName})

For each failure: watch failure.webm, check failure.png, then playwright show-trace on trace.zip.
Reproduce: pnpm exec cucumber-js --config e2e/cucumber.mjs --tags '<scenario-tag>'.
Stack: Playwright + Cucumber, real Claude Agent / Codex against @cradle/model-api-simulator.
\`\`\`

</details>
`
}

module.exports = {
  readJson,
  formatFailureArtifactsSection,
  buildDailyFailureIssueBody,
}
