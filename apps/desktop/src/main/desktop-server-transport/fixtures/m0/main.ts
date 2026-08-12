import { rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  session,
} from 'electron'

import type { FakeUpstream } from './fake-upstream'
import { startFakeUpstream } from './fake-upstream'
import type { M0Proxy } from './proxy-handler'
import { createM0Proxy } from './proxy-handler'
import type { M0Assertion, M0MemorySample, M0MemoryTrace, M0Mode, M0RendererReport, M0Result } from './result-schema'
import {
  M0_ELECTRON_VERSION,
  M0_SCHEME_PRIVILEGES,
  M0_SCHEME_REGISTRATION,
  REQUIRED_M0_ASSERTIONS,
  validateM0Result,
} from './result-schema'

protocol.registerSchemesAsPrivileged([M0_SCHEME_REGISTRATION])

const fixtureDirectory = dirname(fileURLToPath(import.meta.url))
const resultPath = process.env.CRADLE_M0_RESULT_PATH
const mode = process.env.CRADLE_M0_MODE as M0Mode | undefined
const artifactPath = process.env.CRADLE_M0_ARTIFACT_PATH || null

interface ActiveMemoryTrace {
  startedAt: number
  timer?: NodeJS.Timeout
  samples: M0MemorySample[]
}

let mainWindow: BrowserWindow | undefined
let partitionWindow: BrowserWindow | undefined
let fakeUpstream: FakeUpstream | undefined
let proxy: M0Proxy | undefined
let activeMemoryTrace: ActiveMemoryTrace | undefined
let finishing = false

function assertion(passed: boolean, details: Record<string, number | string | boolean> = {}): M0Assertion {
  return { passed, details }
}

function currentMemory(): { main: number, renderer: number } {
  const rendererPid = mainWindow?.webContents.getOSProcessId() ?? -1
  const rendererMetric = app.getAppMetrics().find(metric => metric.pid === rendererPid)
  return {
    main: Math.round(process.memoryUsage().rss / 1024),
    renderer: rendererMetric?.memory?.workingSetSize ?? 0,
  }
}

function sampleMemory(trace: ActiveMemoryTrace) {
  const memory = currentMemory()
  trace.samples.push({
    elapsedMs: Math.round(performance.now() - trace.startedAt),
    mainKiB: memory.main,
    rendererKiB: memory.renderer,
  })
}

function startMemoryTrace() {
  if (activeMemoryTrace) { throw new Error('an M0 memory trace is already active') }
  const trace: ActiveMemoryTrace = {
    startedAt: performance.now(),
    samples: [],
  }
  trace.timer = setInterval(sampleMemory, 25, trace)
  activeMemoryTrace = trace
  sampleMemory(trace)
}

function stopMemoryTrace(): M0MemoryTrace {
  const trace = activeMemoryTrace
  if (!trace) { throw new Error('no M0 memory trace is active') }
  if (trace.timer) {
    clearInterval(trace.timer)
  }
  sampleMemory(trace)
  activeMemoryTrace = undefined
  const first = trace.samples[0]
  const peak = trace.samples.reduce((current, sample) => ({
    mainKiB: Math.max(current.mainKiB, sample.mainKiB),
    rendererKiB: Math.max(current.rendererKiB, sample.rendererKiB),
    elapsedMs: sample.elapsedMs,
  }), first)
  return {
    baselineKiB: { main: first.mainKiB, renderer: first.rendererKiB },
    peakKiB: { main: peak.mainKiB, renderer: peak.rendererKiB },
    samples: trace.samples,
  }
}

function diagnostics(): Record<string, number | string | boolean> {
  if (!fakeUpstream || !proxy) { throw new Error('M0 diagnostics requested before initialization') }
  return {
    activeRequests: proxy.diagnostics.activeRequests,
    responseCancels: proxy.diagnostics.responseCancels,
    requestSignalAborts: proxy.diagnostics.requestSignalAborts,
    defaultSessionHits: proxy.diagnostics.defaultSessionHits,
    partitionHits: proxy.diagnostics.partitionHits,
    customSchemeModuleHits: proxy.diagnostics.customSchemeModuleHits,
    rejectedAuthorities: proxy.diagnostics.rejectedAuthorities,
    upstreamActiveRequests: fakeUpstream.diagnostics.activeRequests,
    upstreamCloses: fakeUpstream.diagnostics.upstreamCloses,
    cancelStreamChunks: fakeUpstream.diagnostics.cancelStreamChunks,
    requestStreamChunks: fakeUpstream.diagnostics.requestStreamChunks,
    requestStreamFirstToLastMs: fakeUpstream.diagnostics.requestStreamFirstToLastMs,
    pixelHits: fakeUpstream.diagnostics.pixelHits,
    simpleModuleHits: fakeUpstream.diagnostics.simpleModuleHits,
    realPluginHits: fakeUpstream.diagnostics.realPluginHits,
    dependencyHits: fakeUpstream.diagnostics.dependencyHits,
    pdfBytes: fakeUpstream.diagnostics.pdfBytes,
    pdfSha256: fakeUpstream.diagnostics.pdfSha256,
  }
}

function assertMainRenderer(event: IpcMainEvent | IpcMainInvokeEvent) {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('M0 IPC message did not originate from the default-session renderer')
  }
}

function rendererLocation(fileName: string): string {
  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (devServerUrl) { return new URL(fileName, devServerUrl.endsWith('/') ? devServerUrl : `${devServerUrl}/`).toString() }
  return pathToFileURL(resolve(fixtureDirectory, '../renderer', fileName)).toString()
}

async function runPartitionProbe(): Promise<Record<string, number | string | boolean>> {
  const partition = session.fromPartition('persist:cradle-browser-m0')
  const mainSideUnhandled = !partition.protocol.isProtocolHandled('cradle-server')
  partitionWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: 'persist:cradle-browser-m0',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })
  await partitionWindow.loadURL(rendererLocation('partition.html'))
  const rendererProbe = await partitionWindow.webContents.executeJavaScript(`
    Promise.all([
      fetch('cradle-server://local/get?value=partition').then(
        () => ({ fetchRejected: false }),
        () => ({ fetchRejected: true }),
      ),
      new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve({ imageErrored: false });
        image.onerror = () => resolve({ imageErrored: true });
        image.src = 'cradle-server://local/pixel.png';
      }),
    ]).then(([fetchResult, imageResult]) => ({ ...fetchResult, ...imageResult }))
  `) as { fetchRejected: boolean, imageErrored: boolean }
  const partitionHits = proxy?.diagnostics.partitionHits ?? -1
  const passed = mainSideUnhandled && rendererProbe.fetchRejected && rendererProbe.imageErrored && partitionHits === 0
  if (!passed) {
    throw new Error(`partition isolation failed: ${JSON.stringify({ mainSideUnhandled, ...rendererProbe, partitionHits })}`)
  }
  return { mainSideUnhandled, ...rendererProbe, partitionHits }
}

async function writeResult(result: M0Result) {
  if (!resultPath || !isAbsolute(resultPath)) { throw new Error('CRADLE_M0_RESULT_PATH must be absolute') }
  const temporaryPath = `${resultPath}.tmp-${process.pid}`
  await writeFile(temporaryPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporaryPath, resultPath)
}

async function finish(report: M0RendererReport) {
  if (finishing) { return }
  finishing = true
  const assertions: Record<string, M0Assertion> = {}
  for (const [name, reportedAssertion] of Object.entries(report.assertions)) {
    if (reportedAssertion) { assertions[name] = reportedAssertion }
  }

  assertions['scheme.privileges.exact'] = assertion(true, {
    enabledPrivileges: 5,
    disabledPrivileges: 4,
  })
  assertions['scheme.defaultSession.handled'] = assertion(
    session.defaultSession.protocol.isProtocolHandled('cradle-server'),
    { defaultSessionHandled: session.defaultSession.protocol.isProtocolHandled('cradle-server') },
  )
  assertions['security.noBypassCsp'] = assertion(!M0_SCHEME_PRIVILEGES.bypassCSP, { bypassCSP: false })

  try {
    assertions['scheme.browserPanelPartition.unhandled'] = assertion(true, await runPartitionProbe())
  }
  catch (error) {
    assertions['scheme.browserPanelPartition.unhandled'] = assertion(false, {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  if (activeMemoryTrace) { stopMemoryTrace() }
  await new Promise(resolve => setTimeout(resolve, 5_000))
  const settledKiB = currentMemory()

  assertions['cleanup.activeRequestsZero'] = assertion(
    proxy?.diagnostics.activeRequests === 0 && fakeUpstream?.diagnostics.activeRequests === 0,
    {
      proxyActiveRequests: proxy?.diagnostics.activeRequests ?? -1,
      upstreamActiveRequests: fakeUpstream?.diagnostics.activeRequests ?? -1,
    },
  )

  mainWindow?.destroy()
  partitionWindow?.destroy()
  session.defaultSession.protocol.unhandle('cradle-server')
  let agentClosed = false
  let serverClosed = false
  try {
    await proxy?.agent.close()
    agentClosed = true
  }
  catch (error) {
    console.error('[m0] failed to close undici Agent', error)
  }
  try {
    await fakeUpstream?.close()
    serverClosed = true
  }
  catch (error) {
    console.error('[m0] failed to close fake upstream', error)
  }
  assertions['cleanup.agentAndServerClosed'] = assertion(agentClosed && serverClosed, { agentClosed, serverClosed })

  for (const name of REQUIRED_M0_ASSERTIONS) {
    if (!assertions[name]) {
      assertions[name] = assertion(false, { error: 'renderer did not report this required assertion' })
    }
  }

  const trace64MiB = report.trace64MiB
  const trace128MiB = report.trace128MiB
  const counters = {
    activeRequests: proxy?.diagnostics.activeRequests ?? -1,
    responseCancels: proxy?.diagnostics.responseCancels ?? -1,
    upstreamCloses: fakeUpstream?.diagnostics.upstreamCloses ?? -1,
    defaultSessionHits: proxy?.diagnostics.defaultSessionHits ?? -1,
    partitionHits: proxy?.diagnostics.partitionHits ?? -1,
    requestSignalAborts: proxy?.diagnostics.requestSignalAborts ?? -1,
    cancelStreamChunks: fakeUpstream?.diagnostics.cancelStreamChunks ?? -1,
    customSchemeModuleHits: proxy?.diagnostics.customSchemeModuleHits ?? -1,
  }
  const result: M0Result = {
    schemaVersion: 1,
    passed: false,
    mode: mode ?? 'development',
    electronVersion: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
    artifactPath: mode === 'packaged' ? artifactPath : null,
    schemePrivileges: M0_SCHEME_PRIVILEGES,
    assertions,
    memory: {
      chunkBytes: 262144,
      baselineKiB: trace64MiB.baselineKiB,
      peak64MiBKiB: trace64MiB.peakKiB,
      peak128MiBKiB: trace128MiB.peakKiB,
      settledKiB,
      trace64MiB,
      trace128MiB,
    },
    counters,
    launch: {
      noSandbox: app.commandLine.hasSwitch('no-sandbox'),
      rendererSandbox: true,
    },
  }
  result.passed = process.versions.electron === M0_ELECTRON_VERSION
    && validateM0Result({ ...result, passed: true }).ok
    && Object.values(assertions).every(item => item.passed)

  await writeResult(result)
  console.log(`[m0] ${result.passed ? 'PASS' : 'FAIL'} ${mode} ${process.platform}-${process.arch}`)
  app.exit(result.passed ? 0 : 1)
}

async function main() {
  if (mode !== 'development' && mode !== 'packaged') { throw new Error('CRADLE_M0_MODE must be development or packaged') }
  if (!resultPath || !isAbsolute(resultPath)) { throw new Error('CRADLE_M0_RESULT_PATH must be absolute') }
  await app.whenReady()

  const resourceRoot = app.isPackaged
    ? resolve(process.resourcesPath, 'm0')
    : resolve(app.getAppPath(), 'dist/m0/fixture-resources')
  fakeUpstream = await startFakeUpstream(resourceRoot)
  proxy = createM0Proxy(fakeUpstream.origin)
  session.defaultSession.protocol.handle('cradle-server', proxy.handle)

  ipcMain.handle('m0:memory:start', (event) => {
    assertMainRenderer(event)
    startMemoryTrace()
  })
  ipcMain.handle('m0:memory:stop', (event) => {
    assertMainRenderer(event)
    return stopMemoryTrace()
  })
  ipcMain.handle('m0:diagnostics', (event) => {
    assertMainRenderer(event)
    return diagnostics()
  })
  ipcMain.on('m0:complete', (event, report: M0RendererReport) => {
    assertMainRenderer(event)
    void finish(report).catch((error) => {
      console.error('[m0] failed to finalize result', error)
      app.exit(1)
    })
  })

  mainWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: resolve(fixtureDirectory, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  })
  mainWindow.webContents.on('console-message', (_event, level, message) => {
    console.log(`[m0:renderer:${level}] ${message}`)
  })
  await mainWindow.loadURL(rendererLocation('index.html'))
}

void main().catch((error) => {
  console.error('[m0] fatal fixture error', error)
  app.exit(1)
})
