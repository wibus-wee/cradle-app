import { readFile } from 'node:fs/promises'
import { Worker } from 'node:worker_threads'

import { instrumentClaudeWorkflowScript } from './declaration-instrumenter'
import type { ClaudeWorkflowInputRecord } from './execution'

export interface ClaudeWorkflowDeclaredPhase {
  index: number
  title: string
  detail: string | null
}

export interface ClaudeWorkflowDeclaredAgent {
  declarationId: string
  index: number
  label: string | null
  phaseIndex: number | null
  phaseTitle: string | null
  prompt: string
}

export interface ClaudeWorkflowDeclaration {
  name: string | null
  description: string | null
  phases: ClaudeWorkflowDeclaredPhase[]
  agents: ClaudeWorkflowDeclaredAgent[]
  branchCount: number
  exploredPathCount: number
  incomplete: boolean
}

interface WorkerPass {
  meta: {
    name: string | null
    description: string | null
    phases: Array<{ title: string, detail: string | null }>
  } | null
  phases: Array<{ title: string }>
  agents: Array<{ label: string | null, phaseTitle: string | null, prompt: string }>
}

interface WorkerResult {
  passes: WorkerPass[]
  exploredPathCount: number
  incomplete: boolean
}

interface WorkerMessage {
  kind: 'progress' | 'complete'
  result: WorkerResult
}

const MAX_SCRIPT_BYTES = 512 * 1024
const MAX_PATHS = 256
const EXTRACTION_TIMEOUT_MS = 3_000

/**
 * Explores the finite Workflow declaration paths reached by an AST-instrumented
 * inert execution. Resource limits are explicit; truncation is surfaced through
 * `incomplete` and never represented as exhaustive discovery.
 */
export async function extractClaudeWorkflowDeclaration(
  input: ClaudeWorkflowInputRecord,
  options: { signal?: AbortSignal } = {},
): Promise<ClaudeWorkflowDeclaration | null> {
  const script = input.script ?? await readScript(input.scriptPath)
  if (!script || Buffer.byteLength(script, 'utf8') > MAX_SCRIPT_BYTES) { return null }

  let instrumented: ReturnType<typeof instrumentClaudeWorkflowScript>
  try {
    instrumented = instrumentClaudeWorkflowScript(script)
  }
  catch {
    return null
  }
  const result = await runDiscoveryWorker(instrumented.code, input.args ?? {}, options.signal)
  if (!result || result.passes.length === 0) { return null }
  return mergeDeclarations(result, instrumented.branchCount)
}

function runDiscoveryWorker(
  code: string,
  args: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<WorkerResult | null> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(null)
      return
    }
    const worker = new Worker(DISCOVERY_WORKER_SOURCE, {
      eval: true,
      workerData: { code, args, maxPaths: MAX_PATHS },
      resourceLimits: {
        maxOldGenerationSizeMb: 64,
        maxYoungGenerationSizeMb: 16,
        stackSizeMb: 4,
      },
    })
    let settled = false
    let latestProgress: WorkerResult | null = null
    const settle = (value: WorkerResult | null) => {
      if (settled) { return }
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      resolve(value)
      void worker.terminate()
    }
    const abort = () => settle(null)
    const timeout = setTimeout(settle, EXTRACTION_TIMEOUT_MS, latestProgress)
    signal?.addEventListener('abort', abort, { once: true })
    worker.on('message', (value) => {
      const message = readWorkerMessage(value)
      if (!message) { return }
      if (message.kind === 'progress') {
        latestProgress = { ...message.result, incomplete: true }
        return
      }
      settle(message.result)
    })
    worker.once('error', () => settle(null))
    worker.once('exit', code => code === 0 ? undefined : settle(null))
  })
}

function mergeDeclarations(result: WorkerResult, branchCount: number): ClaudeWorkflowDeclaration {
  const meta = result.passes.find(pass => pass.meta)?.meta ?? null
  const phaseTitles: string[] = []
  const phaseDetails = new Map<string, string | null>()
  for (const phase of meta?.phases ?? []) {
    addUnique(phaseTitles, phase.title)
    phaseDetails.set(phase.title, phase.detail)
  }
  for (const pass of result.passes) {
    for (const phase of pass.phases) { addUnique(phaseTitles, phase.title) }
  }
  const phases = phaseTitles.map((title, index) => ({
    index: index + 1,
    title,
    detail: phaseDetails.get(title) ?? null,
  }))

  const agents: ClaudeWorkflowDeclaredAgent[] = []
  const seenAgents = new Set<string>()
  for (const pass of result.passes) {
    for (const agent of pass.agents) {
      const identity = JSON.stringify([agent.label, agent.phaseTitle, agent.prompt])
      if (seenAgents.has(identity)) { continue }
      seenAgents.add(identity)
      const index = agents.length + 1
      agents.push({
        declarationId: `declared-agent-${index}`,
        index,
        label: agent.label,
        phaseIndex: agent.phaseTitle ? phases.find(phase => phase.title === agent.phaseTitle)?.index ?? null : null,
        phaseTitle: agent.phaseTitle,
        prompt: agent.prompt,
      })
    }
  }
  return {
    name: meta?.name ?? null,
    description: meta?.description ?? null,
    phases,
    agents,
    branchCount,
    exploredPathCount: result.exploredPathCount,
    incomplete: result.incomplete,
  }
}

function readWorkerResult(value: unknown): WorkerResult | null {
  if (!value || typeof value !== 'object') { return null }
  const result = value as Partial<WorkerResult>
  return Array.isArray(result.passes)
    && typeof result.exploredPathCount === 'number'
    && typeof result.incomplete === 'boolean'
    ? result as WorkerResult
    : null
}

function readWorkerMessage(value: unknown): WorkerMessage | null {
  if (!value || typeof value !== 'object') { return null }
  const message = value as Partial<WorkerMessage>
  const result = readWorkerResult(message.result)
  return (message.kind === 'progress' || message.kind === 'complete') && result
    ? { kind: message.kind, result }
    : null
}

async function readScript(path: string | null): Promise<string | null> {
  return path ? await readFile(path, 'utf8').catch(() => null) : null
}

function addUnique(values: string[], value: string): void {
  if (!values.includes(value)) { values.push(value) }
}

const DISCOVERY_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads')
const vm = require('node:vm')

function pathSignature(path) {
  return JSON.stringify(path)
}

function sameDecision(left, right) {
  return Object.is(left, right)
}

async function runPath(path) {
  const declarations = { meta: null, phases: [], agents: [] }
  const sandbox = {
    __argsData: workerData.args,
    __declarations: declarations,
    __pathEntries: path,
  }
  vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
    name: 'cradle-workflow-declaration',
  })

  const bootstrap = [
    "const __path = new Map(globalThis.__pathEntries.map(entry => [entry.key, entry.value]))",
    "const __trace = []",
    "const __occurrences = new Map()",
    "const __switchSelections = new Map()",
    "let __activePhase = null",
    "function __nextKey(id) { const occurrence = __occurrences.get(id) || 0; __occurrences.set(id, occurrence + 1); return id + '#' + occurrence }",
    "function __choose(id, options, fallback) { const key = __nextKey(id); let chosen = __path.has(key) ? __path.get(key) : fallback(); if (!options.some(option => Object.is(option, chosen))) chosen = options[0]; __trace.push({ key, chosen, options }); return chosen }",
    "function __symbolic(label = 'workflow-value') { const target = function () { return __symbolic(label + '.call') }; return new Proxy(target, { get(_target, property) { if (property === 'then') return undefined; if (property === Symbol.toPrimitive) return hint => hint === 'number' ? 0 : '[' + label + ']'; if (property === Symbol.iterator) return function* () { yield __symbolic(label + '.item') }; if (property === 'toJSON') return () => '[' + label + ']'; if (property === 'length') return 1; return __symbolic(label + '.' + String(property)) }, apply() { return __symbolic(label + '.result') }, construct() { return __symbolic(label + '.instance') } }) }",
    "globalThis.__branch = (id, thunk) => __choose(id, [false, true], () => { const occurrence = (__occurrences.get(id) || 1) - 1; if (id.startsWith('loop:') && occurrence > 0) return false; try { return Boolean(thunk()) } catch { return false } })",
    "globalThis.__switchValue = (id, count, thunk) => { const options = [-1, ...Array.from({ length: count }, (_value, index) => index)]; const selected = __choose(id, options, () => -1); __switchSelections.set(id, selected); try { thunk() } catch {}; return '__workflow_switch_' + id + '_' + selected }",
    "globalThis.__switchCase = (id, index, thunk) => { try { thunk() } catch {}; const selected = __switchSelections.get(id); return selected === index ? '__workflow_switch_' + id + '_' + selected : '__workflow_case_' + id + '_' + index }",
    "globalThis.__iterable = (id, kind, thunk) => { let actual; try { actual = thunk() } catch {}; const hasActual = kind === 'of' ? actual != null && typeof actual[Symbol.iterator] === 'function' && Array.from(actual).length > 0 : actual != null && typeof actual === 'object' && Object.keys(actual).length > 0; const entered = __choose(id, [false, true], () => hasActual); if (!entered) return kind === 'of' ? [] : {}; if (kind === 'of') return hasActual ? actual : [__symbolic(id + '.item')]; return hasActual ? actual : { item: __symbolic(id + '.item') } }",
    "globalThis.args = globalThis.__argsData",
    "globalThis.budget = __symbolic('budget')",
    "globalThis.phase = title => { __activePhase = String(title); globalThis.__declarations.phases.push({ title: __activePhase }) }",
    "globalThis.log = () => undefined",
    "globalThis.agent = async (prompt, options = {}) => { const phaseTitle = options.phase == null ? __activePhase : String(options.phase); globalThis.__declarations.agents.push({ label: options.label == null ? null : String(options.label), phaseTitle, prompt: String(prompt) }); return __symbolic('agent-result') }",
    "globalThis.parallel = async thunks => Promise.all(Array.from(thunks, thunk => thunk()))",
    "globalThis.pipeline = async (items, ...stages) => Promise.all(Array.from(items, async (item, index) => { let value = item; for (const stage of stages) value = await stage(value, index); return value }))",
    "globalThis.workflow = async () => __symbolic('nested-workflow-result')",
    "globalThis.console = { log() {}, info() {}, warn() {}, error() {}, debug() {} }",
    "globalThis.__readTrace = () => __trace",
  ].join('\n')
  new vm.Script(bootstrap).runInContext(sandbox, { timeout: 100 })

  let incomplete = false
  try {
    const execution = new vm.Script('(async () => {\n' + workerData.code + '\n})()', { filename: 'workflow-declaration.js' })
    await Promise.resolve(execution.runInContext(sandbox, { timeout: 250 }))
  }
  catch {
    incomplete = true
  }
  const trace = new vm.Script('globalThis.__readTrace()').runInContext(sandbox, { timeout: 50 })
  return { declarations, trace, incomplete }
}

async function explore() {
  const queue = [[]]
  const seen = new Set([pathSignature([])])
  const passes = []
  let incomplete = false
  let exploredPathCount = 0

  while (queue.length > 0 && exploredPathCount < workerData.maxPaths) {
    const path = queue.shift()
    const run = await runPath(path)
    exploredPathCount += 1
    passes.push(run.declarations)
    incomplete = incomplete || run.incomplete

    parentPort.postMessage({
      kind: 'progress',
      result: { passes, exploredPathCount, incomplete: true },
    })

    for (let index = 0; index < run.trace.length; index += 1) {
      const decision = run.trace[index]
      const prefix = run.trace.slice(0, index).map(item => ({ key: item.key, value: item.chosen }))
      for (const alternative of decision.options) {
        if (sameDecision(alternative, decision.chosen)) continue
        const candidate = [...prefix, { key: decision.key, value: alternative }]
        const signature = pathSignature(candidate)
        if (seen.has(signature)) continue
        seen.add(signature)
        queue.push(candidate)
      }
    }
  }

  if (queue.length > 0) incomplete = true
  return { passes, exploredPathCount, incomplete }
}

explore()
  .then(result => parentPort.postMessage({ kind: 'complete', result }))
  .catch(() => parentPort.postMessage({
    kind: 'complete',
    result: { passes: [], exploredPathCount: 0, incomplete: true },
  }))
`
