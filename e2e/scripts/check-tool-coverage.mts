/**
 * Auto-derived tool coverage contract.
 *
 * Reads the canonical `cradleToolKinds` vocabulary from @cradle/chat-runtime-contracts,
 * the live stable scenario IDs from the Gherkin sources, and the Claude Agent tool
 * classifier, then enforces that every canonical tool kind either has an active e2e
 * journey or is an explicitly accepted gap. Adding a tool kind to the contracts
 * without wiring coverage fails `pnpm e2e:check`.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { classifyClaudeCodeToolKind } from '../../apps/server/src/modules/chat-runtime-providers/claude-agent/tools/mapper'
import { cradleToolKinds } from '../../packages/chat-runtime-contracts/src/index'
import { TOOL_MATRIX_ENTRIES } from '../src/support/scenarios/tool-matrix'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const featureDir = join(root, 'e2e', 'src', 'features')

interface KindCoverage {
  /** Stable scenario IDs whose journeys exercise this tool kind. */
  scenarioIds?: string[]
  /** Accepted gap: no active journey yet, with the reason recorded here. */
  acceptedGap?: string
}

/**
 * One row per canonical tool kind. A kind absent from this map is a hard failure —
 * new vocabulary must consciously choose coverage or an accepted gap.
 */
const KIND_COVERAGE: Record<(typeof cradleToolKinds)[number], KindCoverage> = {
  'file-read': { scenarioIds: ['CRADLE-AGENT-004'] },
  'file-diff': { scenarioIds: ['CRADLE-WORK-001', 'CRADLE-CODEX-007'] },
  'notebook-diff': {
    acceptedGap: 'No runtime currently projects notebook edit tools into Cradle.',
  },
  'terminal': { scenarioIds: ['CRADLE-CODEX-005', 'CRADLE-CODEX-008'] },
  'search': { scenarioIds: ['CRADLE-CHAT-011'] },
  'web': { scenarioIds: ['CRADLE-AGENT-007'] },
  'subagent': {
    acceptedGap: 'Claude Agent Task/Workflow spawns nested agent loops that need multi-exchange FIFO scripting.',
  },
  'task-control': {
    acceptedGap: 'Background task get/output/stop tools need long-lived background shell scripting.',
  },
  'todo': { scenarioIds: ['CRADLE-AGENT-005', 'CRADLE-AGENT-006'] },
  'plan': { scenarioIds: ['CRADLE-AGENT-001', 'CRADLE-AGENT-002'] },
  'plan-implementation': {
    acceptedGap: 'Requires the plan-mode implementation decision flow, which only exists behind plan approval.',
  },
  'question': {
    acceptedGap: 'AskUserQuestion blocks on an interactive control request with no simulator answer path yet.',
  },
  'artifact': { scenarioIds: ['CRADLE-AGENT-010'] },
  'mcp': { scenarioIds: ['CRADLE-AGENT-008'] },
  'worktree': {
    acceptedGap: 'Enter/exit-worktree tools are not emitted by any scripted runtime flow.',
  },
  'generic': { scenarioIds: ['CRADLE-AGENT-009'] },
}

function collectFeatureScenarioIds(): Set<string> {
  const ids = new Set<string>()
  for (const filename of readdirSync(featureDir)) {
    if (!filename.endsWith('.feature')) {
      continue
    }
    const source = readFileSync(join(featureDir, filename), 'utf8')
    for (const match of source.matchAll(/@CRADLE-[A-Z0-9]+-\d{3}/g)) {
      ids.add(match[0].slice(1))
    }
  }
  return ids
}

const failures: string[] = []

// 1. Every canonical kind must appear in the registry.
const registryKinds = new Set(Object.keys(KIND_COVERAGE))
for (const kind of cradleToolKinds) {
  if (!registryKinds.has(kind)) {
    failures.push(`Canonical tool kind "${kind}" is missing from KIND_COVERAGE — add coverage or an acceptedGap.`)
  }
}
for (const kind of registryKinds) {
  if (!cradleToolKinds.includes(kind as never)) {
    failures.push(`KIND_COVERAGE lists "${kind}" which is not in cradleToolKinds anymore.`)
  }
}

// 2. Referenced scenario IDs must exist in the live Gherkin sources.
const liveScenarioIds = collectFeatureScenarioIds()
for (const [kind, coverage] of Object.entries(KIND_COVERAGE)) {
  for (const scenarioId of coverage.scenarioIds ?? []) {
    if (!liveScenarioIds.has(scenarioId)) {
      failures.push(`"${kind}" claims coverage by ${scenarioId}, but that ID is not in any active .feature file.`)
    }
  }
}

// 3. A kind with no scenarios must carry an explicit accepted-gap reason.
for (const [kind, coverage] of Object.entries(KIND_COVERAGE)) {
  const hasScenarios = (coverage.scenarioIds?.length ?? 0) > 0
  if (!hasScenarios && !coverage.acceptedGap) {
    failures.push(`"${kind}" has no scenario coverage and no acceptedGap explanation.`)
  }
}

// 4. Matrix entries must classify to their declared canonical kind via the real mapper.
for (const entry of TOOL_MATRIX_ENTRIES) {
  const classified = classifyClaudeCodeToolKind(entry.wireName)
  if (classified !== entry.expectedKind) {
    failures.push(
      `Tool matrix entry "${entry.key}" (${entry.wireName}) classifies as "${classified}" but declares expectedKind "${entry.expectedKind}".`,
    )
  }
}

if (failures.length > 0) {
  console.error(`E2E tool coverage contract failed with ${failures.length} issue(s):`)
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exitCode = 1
}
else {
  const covered = cradleToolKinds.filter(kind => (KIND_COVERAGE[kind]?.scenarioIds?.length ?? 0) > 0)
  const gaps = cradleToolKinds.filter(kind => !(KIND_COVERAGE[kind]?.scenarioIds?.length ?? 0))
  console.log(`E2E tool coverage contract passed: ${covered.length}/${cradleToolKinds.length} canonical tool kinds have live journeys; ${gaps.length} accepted gaps (${gaps.join(', ') || 'none'}).`)
}
