import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ITestCaseHookParameter } from '@cucumber/cucumber'
import { After, Before, setDefaultTimeout, Status } from '@cucumber/cucumber'

import type { CradleWorld } from './world'
import type { FailureArtifactIndexEntry } from './world-utils'
import {
  ARTIFACTS_GUIDE_FILENAME,
  failureIndexFilename,
} from './world-utils'

const E2E_HOOK_TIMEOUT_MS = 120_000
const ARTIFACTS_ROOT = join(process.cwd(), 'e2e', 'artifacts')
let workerFailureIndexPrepared = false

setDefaultTimeout(E2E_HOOK_TIMEOUT_MS)

function writeArtifactsGuide(): void {
  const guidePath = join(ARTIFACTS_ROOT, ARTIFACTS_GUIDE_FILENAME)
  if (existsSync(guidePath)) {
    return
  }
  mkdirSync(ARTIFACTS_ROOT, { recursive: true })
  writeFileSync(guidePath, `# Cradle E2E failure artifacts

Each failed scenario writes a folder under \`scenarios/<slug>-<n>/\`.

| File | What it is | How to use |
|------|------------|------------|
| \`failure.png\` | Full-page screenshot at the failing step | Open in any image viewer — first look at UI state |
| \`failure.webm\` | 1:1 Chromium recording of the whole scenario | Play in browser/VLC — see the exact click/type path to failure |
| \`trace.zip\` | Playwright trace (DOM snapshots, network, screenshots, source) | \`npx playwright show-trace path/to/trace.zip\` |
| \`console.log\` | Renderer console + page errors + model-api-simulator request ledger | Grep for errors / unexpected LLM wire traffic |

Also at the artifact root:

| File | What it is |
|------|------------|
| \`failure-index.json\` | Machine-readable list of failed scenarios → relative artifact paths |
| \`e2e-summary.md\` / \`.json\` | Aggregated Cucumber pass/fail summary for the run |
| \`cucumber-messages.ndjson\` | Structured Cucumber event stream used to build the run summary |
| \`cucumber-output.log\` | Full Cucumber stdout/stderr |
| \`cucumber-junit.xml\` | JUnit for CI dashboards |

**Video is CI-only** (not attached into Cucumber HTML embeds) to keep report ZIPs small.
`, 'utf8')
}

function appendFailureIndex(entry: FailureArtifactIndexEntry): void {
  mkdirSync(ARTIFACTS_ROOT, { recursive: true })
  const indexPath = join(ARTIFACTS_ROOT, failureIndexFilename())
  const existing = existsSync(indexPath)
    ? JSON.parse(readFileSync(indexPath, 'utf8')) as FailureArtifactIndexEntry[]
    : []
  existing.push(entry)
  writeFileSync(indexPath, JSON.stringify(existing, null, 2), 'utf8')
}

function collectWebmFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return []
  }
  return readdirSync(dir)
    .filter(name => name.endsWith('.webm'))
    .map(name => join(dir, name))
}

Before({ timeout: E2E_HOOK_TIMEOUT_MS }, async function (this: CradleWorld, scenario: ITestCaseHookParameter) {
  if (!workerFailureIndexPrepared) {
    workerFailureIndexPrepared = true
    const indexPath = join(ARTIFACTS_ROOT, failureIndexFilename())
    if (existsSync(indexPath)) {
      unlinkSync(indexPath)
    }
  }
  this.prepareScenario(scenario.pickle.name, scenario.pickle.tags.map(tag => tag.name))
  writeArtifactsGuide()
  if (this.scenarioArtifacts) {
    mkdirSync(this.scenarioArtifacts.scenarioDir, { recursive: true })
  }
  await this.launch()

  this.page.on('console', (msg) => {
    this.pushConsoleMessage(`[console:${msg.type()}] ${msg.text()}`)
  })
  this.page.on('pageerror', (error) => {
    this.pushConsoleMessage(`[pageerror] ${error.message}\n${error.stack ?? ''}`)
  })

  await this.page.context().tracing.start({
    screenshots: true,
    snapshots: true,
    sources: true,
  })
})

After(async function (this: CradleWorld, scenario: ITestCaseHookParameter) {
  const failed = scenario.result?.status === Status.FAILED
  const artifacts = this.scenarioArtifacts
  let artifactError: unknown = null
  const video = this.page?.video() ?? null

  try {
    if (artifacts) {
      mkdirSync(artifacts.scenarioDir, { recursive: true })
    }

    if (failed && this.page && artifacts) {
      await this.page.screenshot({ path: artifacts.screenshotPath, fullPage: true })
      await this.page.context().tracing.stop({ path: artifacts.tracePath })

      const consoleSections = [
        `# Scenario\n${this.scenarioName}`,
        `\n# Renderer console\n${this.consoleMessages.join('\n') || '(no renderer console output)'}`,
        `\n# Simulator requests\n${JSON.stringify(this.simulator?.requests() ?? [], null, 2)}`,
      ]
      writeFileSync(artifacts.consoleLogPath, consoleSections.join('\n'), 'utf8')

      // Attach screenshot + trace + console to Cucumber report (NOT video — keep ZIP lean).
      await this.attach(readFileSync(artifacts.screenshotPath), 'image/png')
      await this.attach(readFileSync(artifacts.tracePath), 'application/zip')
      await this.attach(readFileSync(artifacts.consoleLogPath), 'text/plain')
    }
    else if (this.page) {
      await this.page.context().tracing.stop()
    }
  }
  catch (error) {
    artifactError = error
    console.warn('[e2e] Failed to capture scenario artifacts:', error)
  }
  finally {
    await this.close()
  }

  // Video is finalized only after context.close().
  try {
    if (video && artifacts) {
      const rawPath = await video.path()
      if (failed && rawPath && existsSync(rawPath)) {
        if (rawPath !== artifacts.videoPath) {
          copyFileSync(rawPath, artifacts.videoPath)
          unlinkSync(rawPath)
        }
        appendFailureIndex({
          scenario: this.scenarioName,
          relativeDir: artifacts.relativeDir,
          screenshot: `${artifacts.relativeDir}/failure.png`,
          video: `${artifacts.relativeDir}/failure.webm`,
          trace: `${artifacts.relativeDir}/trace.zip`,
          console: `${artifacts.relativeDir}/console.log`,
        })
      }
      else {
        for (const webm of collectWebmFiles(artifacts.scenarioDir)) {
          unlinkSync(webm)
        }
      }
    }
  }
  catch (error) {
    console.warn('[e2e] Failed to finalize scenario video:', error)
  }

  if (artifactError && !failed) {
    throw artifactError
  }
})
