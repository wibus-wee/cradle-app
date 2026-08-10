import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  createSimulatorApp,
  createSimulatorRuntime,
} from '../../../packages/model-api-simulator/src/server'

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '../../..')
const DEFAULT_DIST_DIR = resolve(REPO_ROOT, 'apps/server/dist-benchmark')
const MODELS_DEV_URL = 'https://models.dev/api.json'
const SIMULATOR_ORIGIN = 'http://model-api-simulator.local'
const MODEL_ID = 'gpt-benchmark'

interface BenchmarkApp {
  handle: (request: Request) => Promise<Response> | Response
  stop: () => Promise<unknown> | unknown
}

interface RegistryRuntime {
  fetchModelsDevData: (options?: { forceRefresh?: boolean }) => Promise<unknown>
  warmupModelsDevCache: () => void
}

interface LatencySummary {
  count: number
  meanMs: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  maxMs: number
}

interface TurnTiming {
  headersMs: number
  firstTokenMs: number
  completeMs: number
}

interface ConcurrencyResult {
  concurrency: number
  iterations: number
  throughputPerSecond: number
  wallMs: number
  headers: LatencySummary
  firstToken: LatencySummary
  complete: LatencySummary
  cpuMs: number
  cpuPercent: number
  peakRssMb: number
  eventLoopP95Ms: number
  simulatorRequests: number
  modelsDevRequests: number
}

interface BenchmarkReport {
  schema: 'cradle-session-startup-benchmark/v1'
  generatedAt: string
  distDir: string
  node: string
  configuration: {
    sessionIterations: number
    serialTurnIterations: number
    concurrentTurnIterations: number
    concurrencies: number[]
    longSessionTurns: number[]
  }
  startup: {
    appCreateMs: number
    registryWarmupMs: number
    modelsDevRequests: number
    modelsDevPeakConcurrency: number
  }
  sessionCreation: {
    coldMs: number
    warm: LatencySummary
    throughputPerSecond: number
  }
  firstTurn: ConcurrencyResult[]
  longSession: Array<{
    priorTurns: number
    nextTurn: TurnTiming
  }>
  simulatorRequestsTotal: number
}

function readPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) {
    return fallback
  }
  const value = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

function readIntegerList(name: string, fallback: number[]): number[] {
  const raw = process.env[name]
  if (!raw) {
    return fallback
  }
  const values = raw.split(',').map(value => Number.parseInt(value.trim(), 10))
  if (values.length === 0 || values.some(value => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error(`${name} must be a comma-separated list of positive integers`)
  }
  return [...new Set(values)]
}

function round(value: number, digits = 2): number {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) {
    return 0
  }
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)
  return sorted[index]!
}

function summarize(values: number[]): LatencySummary {
  const sorted = values.toSorted((left, right) => left - right)
  const total = sorted.reduce((sum, value) => sum + value, 0)
  return {
    count: sorted.length,
    meanMs: round(total / Math.max(1, sorted.length)),
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    p99Ms: round(percentile(sorted, 0.99)),
    maxMs: round(sorted.at(-1) ?? 0),
  }
}

async function loadProductionRuntime(distDir: string): Promise<{
  createServerApp: (options?: { startBackgroundTasks?: boolean }) => Promise<BenchmarkApp>
  registry: RegistryRuntime
  shutdown: () => void
}> {
  const entryPath = join(distDir, 'benchmark-app.js')
  const runtimeModule = await import(pathToFileURL(entryPath).href) as Record<string, unknown>
  const createServerApp = runtimeModule.createServerApp
  if (typeof createServerApp !== 'function') {
    throw new TypeError(`Production benchmark entry ${entryPath} does not export createServerApp`)
  }
  const fetchModelsDevData = runtimeModule.fetchModelsDevData
  const warmupModelsDevCache = runtimeModule.warmupModelsDevCache
  const shutdownBenchmarkRuntime = runtimeModule.shutdownBenchmarkRuntime
  if (typeof fetchModelsDevData !== 'function' || typeof warmupModelsDevCache !== 'function') {
    throw new TypeError(`Production benchmark entry ${entryPath} does not export the registry runtime`)
  }
  if (typeof shutdownBenchmarkRuntime !== 'function') {
    throw new TypeError(`Production benchmark entry ${entryPath} does not export shutdownBenchmarkRuntime`)
  }
  return {
    createServerApp: createServerApp as (options?: { startBackgroundTasks?: boolean }) => Promise<BenchmarkApp>,
    registry: {
      fetchModelsDevData: fetchModelsDevData as RegistryRuntime['fetchModelsDevData'],
      warmupModelsDevCache: warmupModelsDevCache as RegistryRuntime['warmupModelsDevCache'],
    },
    shutdown: shutdownBenchmarkRuntime as () => void,
  }
}

async function requireOk(response: Response, operation: string): Promise<Response> {
  if (response.ok) {
    return response
  }
  throw new Error(`${operation} failed with ${response.status}: ${await response.text()}`)
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

async function createSession(
  app: BenchmarkApp,
  workspaceId: string,
  providerTargetId: string,
  sessionId: string,
): Promise<void> {
  const response = await app.handle(new Request('http://localhost/sessions', jsonRequest('POST', {
    id: sessionId,
    workspaceId,
    title: `Benchmark ${sessionId}`,
    providerTargetId,
    runtimeKind: 'standard',
  })))
  await requireOk(response, `create session ${sessionId}`)
}

async function consumeTurn(app: BenchmarkApp, sessionId: string, text: string): Promise<TurnTiming> {
  const startedAt = performance.now()
  const response = await app.handle(new Request(
    `http://localhost/chat/sessions/${encodeURIComponent(sessionId)}/response`,
    jsonRequest('POST', { text, modelId: MODEL_ID }),
  ))
  await requireOk(response, `run turn for ${sessionId}`)
  const headersAt = performance.now()
  if (!response.body) {
    throw new Error(`Turn ${sessionId} returned no SSE body`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let firstTokenAt: number | null = null
  while (true) {
    const { done, value } = await reader.read()
    pending += decoder.decode(value, { stream: !done })
    const blocks = pending.split('\n\n')
    pending = blocks.pop() ?? ''
    for (const block of blocks) {
      const data = block
        .split('\n')
        .filter(line => line.startsWith('data: '))
        .map(line => line.slice('data: '.length))
        .join('\n')
      if (!data || data === '[DONE]') {
        continue
      }
      const chunk = JSON.parse(data) as { type?: string }
      if (chunk.type === 'text-delta' && firstTokenAt === null) {
        firstTokenAt = performance.now()
      }
    }
    if (done) {
      break
    }
  }
  const completedAt = performance.now()
  if (firstTokenAt === null) {
    throw new Error(`Turn ${sessionId} completed without a text-delta chunk`)
  }
  return {
    headersMs: headersAt - startedAt,
    firstTokenMs: firstTokenAt - startedAt,
    completeMs: completedAt - startedAt,
  }
}

async function benchmarkConcurrency(input: {
  app: BenchmarkApp
  workspaceId: string
  providerTargetId: string
  concurrency: number
  iterations: number
  simulatorRequestCount: () => number
  modelsDevRequestCount: () => number
}): Promise<ConcurrencyResult> {
  const sessionIds: string[] = []
  for (let index = 0; index < input.iterations; index += 1) {
    const sessionId = `bench-c${input.concurrency}-${index}-${randomUUID()}`
    await createSession(input.app, input.workspaceId, input.providerTargetId, sessionId)
    sessionIds.push(sessionId)
  }

  const headers: number[] = []
  const firstTokens: number[] = []
  const completions: number[] = []
  let nextIndex = 0
  let peakRss = process.memoryUsage().rss
  const rssSampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss)
  }, 5)
  rssSampler.unref?.()
  const eventLoop = monitorEventLoopDelay({ resolution: 10 })
  eventLoop.enable()
  const cpuStart = process.cpuUsage()
  const simulatorStart = input.simulatorRequestCount()
  const modelsDevStart = input.modelsDevRequestCount()
  const wallStartedAt = performance.now()

  const workers: Array<Promise<void>> = []
  for (let workerIndex = 0; workerIndex < Math.min(input.concurrency, sessionIds.length); workerIndex += 1) {
    workers.push((async () => {
      while (true) {
        const index = nextIndex
        nextIndex += 1
        const sessionId = sessionIds[index]
        if (!sessionId) {
          return
        }
        const timing = await consumeTurn(input.app, sessionId, `benchmark turn ${index}`)
        headers.push(timing.headersMs)
        firstTokens.push(timing.firstTokenMs)
        completions.push(timing.completeMs)
      }
    })())
  }
  await Promise.all(workers)

  const wallMs = performance.now() - wallStartedAt
  const cpu = process.cpuUsage(cpuStart)
  eventLoop.disable()
  clearInterval(rssSampler)
  const cpuMs = (cpu.user + cpu.system) / 1_000
  return {
    concurrency: input.concurrency,
    iterations: input.iterations,
    throughputPerSecond: round(input.iterations / (wallMs / 1_000)),
    wallMs: round(wallMs),
    headers: summarize(headers),
    firstToken: summarize(firstTokens),
    complete: summarize(completions),
    cpuMs: round(cpuMs),
    cpuPercent: round((cpuMs / wallMs) * 100),
    peakRssMb: round(peakRss / 1024 / 1024),
    eventLoopP95Ms: round(eventLoop.percentile(95) / 1_000_000),
    simulatorRequests: input.simulatorRequestCount() - simulatorStart,
    modelsDevRequests: input.modelsDevRequestCount() - modelsDevStart,
  }
}

function printReport(report: BenchmarkReport): void {
  console.log(JSON.stringify(report, null, 2))
}

async function main(): Promise<void> {
  const sessionIterations = readPositiveInteger('CRADLE_BENCH_SESSION_ITERATIONS', 100)
  const serialTurnIterations = readPositiveInteger('CRADLE_BENCH_SERIAL_ITERATIONS', 80)
  const concurrentTurnIterations = readPositiveInteger('CRADLE_BENCH_CONCURRENT_ITERATIONS', 160)
  const concurrencies = readIntegerList('CRADLE_BENCH_CONCURRENCIES', [1, 8, 32, 64])
  const longSessionTurns = readIntegerList('CRADLE_BENCH_LONG_TURNS', [100, 400])
  const configuredDistDir = process.env.CRADLE_BENCH_DIST_DIR ?? DEFAULT_DIST_DIR
  const distDir = isAbsolute(configuredDistDir)
    ? configuredDistDir
    : resolve(REPO_ROOT, configuredDistDir)
  const dataDir = mkdtempSync(join(tmpdir(), 'cradle-session-benchmark-data-'))
  const previousEnv = {
    dataDir: process.env.CRADLE_DATA_DIR,
    credentialSecret: process.env.CRADLE_CREDENTIAL_SECRET,
    logLevel: process.env.CRADLE_LOG_LEVEL,
    authRequired: process.env.CRADLE_AUTH_REQUIRED,
    migrationsDir: process.env.CRADLE_MIGRATIONS_DIR,
  }
  process.env.CRADLE_DATA_DIR = dataDir
  process.env.CRADLE_CREDENTIAL_SECRET = 'session-benchmark-secret'
  process.env.CRADLE_LOG_LEVEL = 'error'
  process.env.CRADLE_AUTH_REQUIRED = 'false'
  process.env.CRADLE_MIGRATIONS_DIR = resolve(REPO_ROOT, 'packages/db/drizzle')

  const simulatorRuntime = createSimulatorRuntime()
  const simulatorApp = createSimulatorApp(simulatorRuntime, { autoRespond: true })
  const nativeFetch = globalThis.fetch
  let modelsDevRequests = 0
  let modelsDevActiveRequests = 0
  let modelsDevPeakConcurrency = 0
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    if (request.url === MODELS_DEV_URL) {
      modelsDevRequests += 1
      modelsDevActiveRequests += 1
      modelsDevPeakConcurrency = Math.max(modelsDevPeakConcurrency, modelsDevActiveRequests)
      try {
        await Promise.resolve()
        return new Response(JSON.stringify({
          benchmark: {
            name: 'Benchmark',
            api: `${SIMULATOR_ORIGIN}/v1`,
            models: {
              [MODEL_ID]: {
                id: MODEL_ID,
                name: 'GPT Benchmark',
                limit: { context: 128_000, output: 4_096 },
                cost: { input: 1, output: 2 },
              },
            },
          },
        }), { headers: { 'content-type': 'application/json' } })
      }
      finally {
        modelsDevActiveRequests -= 1
      }
    }
    if (new URL(request.url).origin === SIMULATOR_ORIGIN) {
      const mappedUrl = new URL(request.url)
      mappedUrl.protocol = 'http:'
      mappedUrl.host = 'simulator'
      return simulatorApp.handle(new Request(mappedUrl, request))
    }
    throw new Error(`Unexpected network request during benchmark: ${request.method} ${request.url}`)
  }

  let app: BenchmarkApp | null = null
  let shutdownRuntime: (() => void) | null = null
  try {
    const runtime = await loadProductionRuntime(distDir)
    shutdownRuntime = runtime.shutdown
    const appStartedAt = performance.now()
    app = await runtime.createServerApp({ startBackgroundTasks: false })
    const appCreateMs = performance.now() - appStartedAt

    const registryStartedAt = performance.now()
    await runtime.registry.fetchModelsDevData({ forceRefresh: true })
    const registryWarmupMs = performance.now() - registryStartedAt

    const credentialResponse = await requireOk(await app.handle(new Request(
      'http://localhost/secrets',
      jsonRequest('POST', {
        kind: 'openai-compatible',
        label: 'Session benchmark key',
        secret: 'sk-session-benchmark',
      }),
    )), 'create benchmark credential')
    const credential = await credentialResponse.json() as { id: string }
    const workspaceRoot = join(dataDir, 'workspace')
    mkdirSync(workspaceRoot)
    const workspaceResponse = await requireOk(await app.handle(new Request(
      'http://localhost/workspaces',
      jsonRequest('POST', {
        name: 'Session Benchmark Workspace',
        locator: { hostId: 'local', path: workspaceRoot },
      }),
    )), 'create benchmark workspace')
    const workspace = await workspaceResponse.json() as { id: string }
    const providerTargetId = 'provider-target-session-benchmark'
    await requireOk(await app.handle(new Request(
      `http://localhost/provider-targets/${providerTargetId}`,
      jsonRequest('PUT', {
        displayName: 'Session Benchmark Provider',
        providerKind: 'openai-compatible',
        enabled: true,
        connectionConfig: {
          baseUrl: `${SIMULATOR_ORIGIN}/v1`,
          model: MODEL_ID,
          apiMode: 'responses',
          maxMessages: 50,
        },
        credentialRef: credential.id,
      }),
    )), 'create benchmark provider target')

    const coldSessionStartedAt = performance.now()
    await createSession(app, workspace.id, providerTargetId, `bench-session-cold-${randomUUID()}`)
    const coldSessionMs = performance.now() - coldSessionStartedAt
    const sessionLatencies: number[] = []
    const sessionBatchStartedAt = performance.now()
    for (let index = 0; index < sessionIterations; index += 1) {
      const startedAt = performance.now()
      await createSession(app, workspace.id, providerTargetId, `bench-session-warm-${index}-${randomUUID()}`)
      sessionLatencies.push(performance.now() - startedAt)
    }
    const sessionBatchMs = performance.now() - sessionBatchStartedAt

    const warmupSessionId = `bench-turn-warmup-${randomUUID()}`
    await createSession(app, workspace.id, providerTargetId, warmupSessionId)
    await consumeTurn(app, warmupSessionId, 'warm up the runtime')

    const firstTurn: ConcurrencyResult[] = []
    for (const concurrency of concurrencies) {
      firstTurn.push(await benchmarkConcurrency({
        app,
        workspaceId: workspace.id,
        providerTargetId,
        concurrency,
        iterations: concurrency === 1 ? serialTurnIterations : concurrentTurnIterations,
        simulatorRequestCount: () => simulatorRuntime.controller.requests().length,
        modelsDevRequestCount: () => modelsDevRequests,
      }))
    }

    const longSessionId = `bench-long-${randomUUID()}`
    await createSession(app, workspace.id, providerTargetId, longSessionId)
    const longSession: BenchmarkReport['longSession'] = []
    let completedTurns = 0
    for (const priorTurns of longSessionTurns.toSorted((left, right) => left - right)) {
      while (completedTurns < priorTurns) {
        await consumeTurn(app, longSessionId, `seed turn ${completedTurns + 1}`)
        completedTurns += 1
      }
      const nextTurn = await consumeTurn(app, longSessionId, `measure after ${priorTurns} turns`)
      completedTurns += 1
      longSession.push({
        priorTurns,
        nextTurn: {
          headersMs: round(nextTurn.headersMs),
          firstTokenMs: round(nextTurn.firstTokenMs),
          completeMs: round(nextTurn.completeMs),
        },
      })
    }

    const report: BenchmarkReport = {
      schema: 'cradle-session-startup-benchmark/v1',
      generatedAt: new Date().toISOString(),
      distDir,
      node: process.version,
      configuration: {
        sessionIterations,
        serialTurnIterations,
        concurrentTurnIterations,
        concurrencies,
        longSessionTurns,
      },
      startup: {
        appCreateMs: round(appCreateMs),
        registryWarmupMs: round(registryWarmupMs),
        modelsDevRequests,
        modelsDevPeakConcurrency,
      },
      sessionCreation: {
        coldMs: round(coldSessionMs),
        warm: summarize(sessionLatencies),
        throughputPerSecond: round(sessionIterations / (sessionBatchMs / 1_000)),
      },
      firstTurn,
      longSession,
      simulatorRequestsTotal: simulatorRuntime.controller.requests().length,
    }
    printReport(report)
    const outputPath = process.env.CRADLE_BENCH_OUTPUT
    if (outputPath) {
      writeFileSync(
        isAbsolute(outputPath) ? outputPath : resolve(REPO_ROOT, outputPath),
        `${JSON.stringify(report, null, 2)}\n`,
      )
    }
  }
  finally {
    try {
      shutdownRuntime?.()
    }
    finally {
      globalThis.fetch = nativeFetch
      simulatorRuntime.controller.close()
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousEnv.dataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousEnv.credentialSecret)
      restoreEnv('CRADLE_LOG_LEVEL', previousEnv.logLevel)
      restoreEnv('CRADLE_AUTH_REQUIRED', previousEnv.authRequired)
      restoreEnv('CRADLE_MIGRATIONS_DIR', previousEnv.migrationsDir)
    }
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  }
  else {
    process.env[name] = value
  }
}

await main()
