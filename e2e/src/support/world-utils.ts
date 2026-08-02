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

export function buildScenarioArtifactPaths(
  artifactsRoot: string,
  scenarioName: string,
  caseIndex: number,
): ScenarioArtifactPaths {
  const slug = slugifyScenarioName(scenarioName)
  const folderName = `${slug}-${caseIndex}`
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

export const FAILURE_INDEX_FILENAME = 'failure-index.json'
export const ARTIFACTS_GUIDE_FILENAME = 'ARTIFACTS.md'
