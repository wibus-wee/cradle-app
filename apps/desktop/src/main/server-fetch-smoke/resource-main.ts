import { mkdir, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'

import { app, BrowserWindow, ipcMain } from 'electron'

import { ChatStreamBroker } from '../chat-stream-broker'
import { DesktopServerFetchBroker } from '../server-fetch-broker'

interface ResourceConfig {
  durationMs: number
  contextTokens: number
  finiteRequests: number
  finiteConcurrency: number
  streamIntervalMs: number
  backgroundBurstIntervalMs: number
  settleMs: number
}

interface ResourceSample {
  elapsedMs: number
  phase: string
  main: {
    heapUsedBytes: number
    rssBytes: number
    privateBytes: number
    workingSetBytes: number
    cpuPercent: number
  }
  renderer: {
    privateBytes: number
    workingSetBytes: number
    cpuPercent: number
  } | null
  serverFetch: ReturnType<DesktopServerFetchBroker['diagnostics']>
  chatStreams: number
  chatReplayChunks: number
}

const config: ResourceConfig = {
  durationMs: readPositiveInteger('CRADLE_SERVER_FETCH_SOAK_DURATION_MS', 120_000),
  contextTokens: readPositiveInteger('CRADLE_SERVER_FETCH_SOAK_CONTEXT_TOKENS', 200_000),
  finiteRequests: readPositiveInteger('CRADLE_SERVER_FETCH_SOAK_FINITE_REQUESTS', 2_000),
  finiteConcurrency: readPositiveInteger('CRADLE_SERVER_FETCH_SOAK_CONCURRENCY', 64),
  streamIntervalMs: readPositiveInteger('CRADLE_SERVER_FETCH_SOAK_STREAM_INTERVAL_MS', 20),
  backgroundBurstIntervalMs: readPositiveInteger(
    'CRADLE_SERVER_FETCH_SOAK_BACKGROUND_BURST_INTERVAL_MS',
    1_000,
  ),
  settleMs: readPositiveInteger('CRADLE_SERVER_FETCH_SOAK_SETTLE_MS', 15_000),
}
const resultPath = process.env.CRADLE_SERVER_FETCH_SMOKE_RESULT
const startedAt = Date.now()
const samples: ResourceSample[] = []
let phase = 'startup'
let window: BrowserWindow | null = null
let rendererPid = 0
let settled = false
let finiteRequestsAccepted = 0
let streamBytesWritten = 0
let chatRequestBytes = 0
let chatChunksWritten = 0
let releaseBaseline: (() => void) | null = null
const baselineReady = new Promise<void>((resolve) => {
  releaseBaseline = resolve
})

const windows = new Set<number>()
const serverFetchBroker = new DesktopServerFetchBroker({
  isAllowedSender: sender => windows.has(sender.id),
})
let chatStreamBroker: ChatStreamBroker | null = null

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    response.writeHead(500).end(error instanceof Error ? error.message : String(error))
  })
})

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (url.pathname === '/finite') {
    finiteRequestsAccepted += 1
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ request: url.searchParams.get('request') }))
    return
  }
  if (url.pathname === '/resource-stream') {
    response.writeHead(200, {
      'cache-control': 'no-cache',
      'content-type': 'text/event-stream',
    })
    const until = Date.now() + config.durationMs
    while (Date.now() < until && !response.destroyed) {
      const frame = `data: ${'s'.repeat(256)}\n\n`
      streamBytesWritten += Buffer.byteLength(frame)
      response.write(frame)
      await delay(config.streamIntervalMs)
    }
    response.end('data: [DONE]\n\n')
    return
  }
  if (/^\/chat\/sessions\/[^/]+\/response$/.test(url.pathname)) {
    const body = await readBody(request)
    chatRequestBytes = body.byteLength
    JSON.parse(body.toString('utf8'))
    response.writeHead(200, {
      'cache-control': 'no-cache',
      'content-type': 'text/event-stream',
      'x-cradle-run-id': 'resource-run',
      'x-cradle-assistant-message-id': 'resource-assistant',
      'x-cradle-user-message-id': 'resource-user',
    })
    response.write('data: {"type":"start","messageId":"resource-assistant"}\n\n')
    response.write('data: {"type":"text-start","id":"resource-text"}\n\n')
    const until = Date.now() + config.durationMs
    while (Date.now() < until && !response.destroyed) {
      const chunk = {
        type: 'text-delta',
        id: 'resource-text',
        delta: 'c'.repeat(256),
      }
      response.write(`data: ${JSON.stringify(chunk)}\n\n`)
      chatChunksWritten += 1
      await delay(config.streamIntervalMs)
    }
    response.end([
      'data: {"type":"text-end","id":"resource-text"}\n\n',
      'data: {"type":"finish","finishReason":"stop"}\n\n',
      'data: [DONE]\n\n',
    ].join(''))
    return
  }
  response.writeHead(404).end('not found')
}

async function sample(): Promise<void> {
  const [memory, metrics] = await Promise.all([
    process.getProcessMemoryInfo(),
    Promise.resolve(app.getAppMetrics()),
  ])
  const mainMetric = metrics.find(metric => metric.pid === process.pid)
  const rendererMetric = metrics.find(metric => metric.pid === rendererPid)
  const heap = process.memoryUsage()
  const chatDiagnostics = chatStreamBroker?.diagnostics()
  samples.push({
    elapsedMs: Date.now() - startedAt,
    phase,
    main: {
      heapUsedBytes: heap.heapUsed,
      rssBytes: heap.rss,
      privateBytes: memory.private * 1024,
      workingSetBytes: memory.workingSetSize * 1024,
      cpuPercent: mainMetric?.cpu.percentCPUUsage ?? 0,
    },
    renderer: rendererMetric
      ? {
          privateBytes: rendererMetric.memory.privateBytes * 1024,
          workingSetBytes: rendererMetric.memory.workingSetSize * 1024,
          cpuPercent: rendererMetric.cpu.percentCPUUsage,
        }
      : null,
    serverFetch: serverFetchBroker.diagnostics(),
    chatStreams: chatDiagnostics?.streams.length ?? 0,
    chatReplayChunks: chatDiagnostics?.streams.reduce(
      (total, stream) => total + stream.replayChunkCount,
      0,
    ) ?? 0,
  })
}

async function finish(rendererResult: unknown, error?: unknown): Promise<void> {
  if (settled) {
    return
  }
  settled = true
  phase = 'finished'
  await sample().catch(() => {})
  const baseline = lastSampleForPhase('baseline') ?? samples[0]
  const final = samples.at(-1)
  const peakMainPrivateBytes = Math.max(...samples.map(value => value.main.privateBytes))
  const peakMainHeapBytes = Math.max(...samples.map(value => value.main.heapUsedBytes))
  const peakMainCpuPercent = Math.max(...samples.map(value => value.main.cpuPercent))
  const peakRendererPrivateBytes = Math.max(
    0,
    ...samples.map(value => value.renderer?.privateBytes ?? 0),
  )
  const finalDiagnostics = serverFetchBroker.diagnostics()
  const resultError = error instanceof Error ? error.message : error ? String(error) : null
  const passed = !resultError
    && finiteRequestsAccepted >= config.finiteRequests
    && chatRequestBytes >= config.contextTokens * 4
    && chatChunksWritten > 0
    && streamBytesWritten > 0
    && finalDiagnostics.activeRequests === 0
    && baseline !== undefined
    && final !== undefined
    && final.main.privateBytes - baseline.main.privateBytes < 96 * 1024 * 1024
    && peakMainPrivateBytes - baseline.main.privateBytes < 256 * 1024 * 1024
  const result = {
    schemaVersion: 1,
    profile: 'resource',
    passed,
    error: resultError,
    config,
    counters: {
      finiteRequestsAccepted,
      streamBytesWritten,
      chatRequestBytes,
      chatChunksWritten,
    },
    summary: {
      baselineMainPrivateBytes: baseline?.main.privateBytes ?? null,
      finalMainPrivateBytes: final?.main.privateBytes ?? null,
      peakMainPrivateBytes,
      peakMainHeapBytes,
      peakMainCpuPercent,
      peakRendererPrivateBytes,
      mainSettledDeltaBytes: baseline && final
        ? final.main.privateBytes - baseline.main.privateBytes
        : null,
      mainPeakDeltaBytes: baseline ? peakMainPrivateBytes - baseline.main.privateBytes : null,
    },
    diagnostics: finalDiagnostics,
    rendererResult,
    samples,
  }
  if (resultPath) {
    await mkdir(dirname(resultPath), { recursive: true })
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  }
  console.log(`CRADLE_SERVER_FETCH_RESOURCE=${JSON.stringify({ ...result, samples: undefined })}`)
  window?.destroy()
  chatStreamBroker?.stop()
  await serverFetchBroker.close().catch(() => {})
  await new Promise<void>(resolve => server.close(() => resolve()))
  app.exit(passed ? 0 : 1)
}

function lastSampleForPhase(expected: string): ResourceSample | undefined {
  return [...samples].reverse().find(sample => sample.phase === expected)
}

async function run(): Promise<void> {
  serverFetchBroker.register(ipcMain)
  ipcMain.handle('server-fetch-resource:get-config', async () => {
    await baselineReady
    return config
  })
  ipcMain.on('server-fetch-resource:phase', (_event, nextPhase: unknown) => {
    if (typeof nextPhase === 'string') {
      phase = nextPhase
      void sample()
    }
  })
  ipcMain.handle('server-fetch-resource:chat-start', async (event, request: unknown) =>
    await chatStreamBroker!.startResponse(event.sender, request as never))
  ipcMain.on('server-fetch-resource:complete', (_event, result: unknown) => {
    void finish(result)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Resource Server did not expose a TCP address.')
  }
  const serverUrl = `http://127.0.0.1:${address.port}`
  serverFetchBroker.setServerUrl(serverUrl, 1)
  chatStreamBroker = new ChatStreamBroker({ serverUrl })

  window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
    },
  })
  windows.add(window.webContents.id)
  rendererPid = window.webContents.getOSProcessId()
  await window.loadFile(join(__dirname, '../renderer/index.html'), {
    query: { profile: 'resource' },
  })
  rendererPid = window.webContents.getOSProcessId()
  phase = 'baseline'
  await delay(2_000)
  await sample()
  releaseBaseline?.()
  releaseBaseline = null
  const sampler = setInterval(() => void sample(), 1_000)
  sampler.unref()
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return value
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const timeout = setTimeout(() => {
  void finish(null, new Error('Server fetch resource smoke timed out.'))
}, config.durationMs + config.settleMs + 120_000)
timeout.unref()

app.whenReady().then(run).catch(error => finish(null, error))
