import { join } from 'node:path'

const WHITESPACE_RE = /\s+/g
const NON_SLUG_CHAR_RE = /[^a-z0-9-_]/g
const DUPLICATE_DASH_RE = /-+/g
const EDGE_DASH_RE = /^-+|-+$/g

export interface ScenarioArtifactPaths {
  slug: string
  scenarioDir: string
  /** Relative to e2e/artifacts — used in CI issue copy */
  relativeDir: string
  screenshotPath: string
  tracePath: string
  consoleLogPath: string
  /** Final failure video path (webm). Raw Playwright files may land beside it. */
  videoPath: string
}

export function slugifyScenarioName(name: string): string {
  const collapsed = name.trim().toLowerCase().replace(WHITESPACE_RE, '-')
  const safe = collapsed.replace(NON_SLUG_CHAR_RE, '-').replace(DUPLICATE_DASH_RE, '-')
  const finalValue = safe.replace(EDGE_DASH_RE, '')
  return finalValue || 'unnamed-scenario'
}

/** Cucumber parallel workers are separate processes; suffix shared artifact paths by worker. */
export function cucumberWorkerId(): string | null {
  return process.env.CUCUMBER_WORKER_ID ?? null
}

export function buildScenarioArtifactPaths(
  artifactsRoot: string,
  scenarioName: string,
  caseIndex: number,
): ScenarioArtifactPaths {
  const slug = slugifyScenarioName(scenarioName)
  const worker = cucumberWorkerId()
  const folderName = worker ? `${slug}-w${worker}-${caseIndex}` : `${slug}-${caseIndex}`
  const scenarioDir = join(artifactsRoot, 'scenarios', folderName)
  return {
    slug,
    scenarioDir,
    relativeDir: `scenarios/${folderName}`,
    screenshotPath: join(scenarioDir, 'failure.png'),
    tracePath: join(scenarioDir, 'trace.zip'),
    consoleLogPath: join(scenarioDir, 'console.log'),
    videoPath: join(scenarioDir, 'failure.webm'),
  }
}

export interface FailureArtifactIndexEntry {
  scenario: string
  relativeDir: string
  screenshot: string
  video: string
  trace: string
  console: string
}

export function failureIndexFilename(): string {
  const worker = cucumberWorkerId()
  return worker ? `failure-index.w${worker}.json` : 'failure-index.json'
}
export const ARTIFACTS_GUIDE_FILENAME = 'ARTIFACTS.md'
