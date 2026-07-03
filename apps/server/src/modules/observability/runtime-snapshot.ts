import {
  updateChatRuntimeMetrics,
  updateChronicleMetrics,
  updateDesktopMetrics,
  updateObservabilityMetrics,
  updateOpencodeServerMetrics,
  updateProviderRuntimeMetrics,
  updatePtyMetrics,
  updateServerProcessMetrics
} from '../../telemetry/metrics'
import * as ChatRuntime from '../chat-runtime/runtime'
import { getOpencodeServerResources } from '../chat-runtime-providers/opencode/runtime-context'
import { getDaemonResources } from '../chronicle/daemon-manager'
import * as Health from '../health/service'
import { providerRuntimeHostManager } from '../provider-runtime/host-manager'
import * as Pty from '../pty/service'
import { getDesktopRuntimeSamples, getQueueHealth } from './service'

const TOP_DRILLDOWN_LIMIT = 10

function toMB(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100
}

function incrementBucket(buckets: Record<string, number>, key: string, amount = 1): void {
  buckets[key] = (buckets[key] ?? 0) + amount
}

function readActiveResourceCount(name: '_getActiveHandles' | '_getActiveRequests'): number {
  const reader = (process as unknown as Record<string, unknown>)[name]
  if (typeof reader !== 'function') {
    return 0
  }
  try {
    const value = reader()
    return Array.isArray(value) ? value.length : 0
  } catch {
    return 0
  }
}

function readRecordNumber(record: Record<string, unknown> | undefined, key: string): number | null {
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readNestedRecord(
  record: Record<string, unknown>,
  key: string
): Record<string, unknown> | undefined {
  const value = record[key]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function readNestedArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key]
  return Array.isArray(value) ? value : []
}

function readRecordString(record: Record<string, unknown> | undefined, key: string): string | null {
  const value = record?.[key]
  return typeof value === 'string' ? value : null
}

function readRecordBoolean(
  record: Record<string, unknown> | undefined,
  key: string
): boolean | null {
  const value = record?.[key]
  return typeof value === 'boolean' ? value : null
}

function toBytesFromKiB(value: number | null): number | null {
  return value === null ? null : value * 1024
}

function summarizeRendererDrilldowns(latestDesktopSample: Record<string, unknown> | undefined) {
  const diagnostics = latestDesktopSample
    ? readNestedRecord(latestDesktopSample, 'diagnostics')
    : undefined
  const renderers = readNestedArray(diagnostics ?? {}, 'renderers')
  const topChatSessions: Array<Record<string, unknown>> = []
  const activeStreamingMessages: Array<Record<string, unknown>> = []
  const runDisplayMetaMessages: Array<Record<string, unknown>> = []
  const rendererWindows: Array<Record<string, unknown>> = []

  for (const item of renderers) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue
    }
    const rendererEntry = item as Record<string, unknown>
    const renderer = readNestedRecord(rendererEntry, 'renderer')
    const chatStore = readNestedRecord(renderer ?? {}, 'chatStore')
    const location = readNestedRecord(renderer ?? {}, 'location')
    const electron = readNestedRecord(renderer ?? {}, 'electron')
    const rendererMemory = readNestedRecord(renderer ?? {}, 'rendererMemory')
    const currentMemory = readNestedRecord(rendererMemory ?? {}, 'current')
    const documentMetrics = readNestedRecord(renderer ?? {}, 'document')

    const windowIdentity = {
      windowId: readRecordNumber(rendererEntry, 'windowId'),
      title: readRecordString(rendererEntry, 'title'),
      visible: readRecordBoolean(rendererEntry, 'visible'),
      webContentsId: readRecordNumber(rendererEntry, 'webContentsId'),
      rendererProcessId: readRecordNumber(rendererEntry, 'rendererProcessId'),
      url: readRecordString(rendererEntry, 'url'),
      locationHash: readRecordString(location, 'hash'),
      locationPathname: readRecordString(location, 'pathname'),
      electronSessionId: readRecordString(electron, 'sessionId'),
      electronSurface: readRecordString(electron, 'surface'),
      electronIsTearoff: readRecordBoolean(electron, 'isTearoff'),
      usedJSHeapSize: readRecordNumber(currentMemory, 'usedJSHeapSize'),
      totalJSHeapSize: readRecordNumber(currentMemory, 'totalJSHeapSize'),
      nodeCount: readRecordNumber(documentMetrics, 'nodeCount'),
      messageBubbleCount: readRecordNumber(documentMetrics, 'messageBubbleCount'),
      toolCallCount: readRecordNumber(documentMetrics, 'toolCallCount')
    }
    rendererWindows.push(windowIdentity)

    for (const session of readNestedArray(chatStore ?? {}, 'sessions')) {
      if (!session || typeof session !== 'object' || Array.isArray(session)) {
        continue
      }
      const sessionRecord = session as Record<string, unknown>
      topChatSessions.push({
        ...windowIdentity,
        sessionId: readRecordString(sessionRecord, 'sessionId'),
        hydrated: readRecordBoolean(sessionRecord, 'hydrated'),
        messageCount: readRecordNumber(sessionRecord, 'messageCount'),
        partCount: readRecordNumber(sessionRecord, 'partCount'),
        textPartCount: readRecordNumber(sessionRecord, 'textPartCount'),
        toolPartCount: readRecordNumber(sessionRecord, 'toolPartCount'),
        filePartCount: readRecordNumber(sessionRecord, 'filePartCount'),
        estimatedPartStringChars: readRecordNumber(sessionRecord, 'estimatedPartStringChars'),
        streamingMessageCount: readRecordNumber(sessionRecord, 'streamingMessageCount'),
        generatingMessageCount: readRecordNumber(sessionRecord, 'generatingMessageCount'),
        passiveStreamingMessageCount: readRecordNumber(
          sessionRecord,
          'passiveStreamingMessageCount'
        ),
        hasLocalDriver: readRecordBoolean(sessionRecord, 'hasLocalDriver'),
        passiveStatus: readRecordString(sessionRecord, 'passiveStatus'),
        errorCount: readRecordNumber(sessionRecord, 'errorCount'),
        activeGoal: readRecordBoolean(sessionRecord, 'activeGoal'),
        assistantDisplaySplitCount: readRecordNumber(sessionRecord, 'assistantDisplaySplitCount')
      })
    }

    for (const message of readNestedArray(chatStore ?? {}, 'activeStreamingMessages')) {
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        continue
      }
      const messageRecord = message as Record<string, unknown>
      activeStreamingMessages.push({
        ...windowIdentity,
        sessionId: readRecordString(messageRecord, 'sessionId'),
        messageId: readRecordString(messageRecord, 'messageId'),
        generating: readRecordBoolean(messageRecord, 'generating'),
        passiveStreaming: readRecordBoolean(messageRecord, 'passiveStreaming'),
        localDriver: readRecordBoolean(messageRecord, 'localDriver'),
        runActive: readRecordBoolean(messageRecord, 'runActive'),
        runId: readRecordString(messageRecord, 'runId'),
        runCompletedAtMs: readRecordNumber(messageRecord, 'runCompletedAtMs'),
        role: readRecordString(messageRecord, 'role'),
        partCount: readRecordNumber(messageRecord, 'partCount'),
        estimatedPartStringChars: readRecordNumber(messageRecord, 'estimatedPartStringChars')
      })
    }

    for (const message of readNestedArray(chatStore ?? {}, 'runDisplayMetaMessages')) {
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        continue
      }
      const messageRecord = message as Record<string, unknown>
      runDisplayMetaMessages.push({
        ...windowIdentity,
        sessionId: readRecordString(messageRecord, 'sessionId'),
        messageId: readRecordString(messageRecord, 'messageId'),
        runId: readRecordString(messageRecord, 'runId'),
        completedAtMs: readRecordNumber(messageRecord, 'completedAtMs'),
        generating: readRecordBoolean(messageRecord, 'generating'),
        passiveStreaming: readRecordBoolean(messageRecord, 'passiveStreaming'),
        localDriver: readRecordBoolean(messageRecord, 'localDriver'),
        role: readRecordString(messageRecord, 'role'),
        partCount: readRecordNumber(messageRecord, 'partCount'),
        splitSourceMessageId: readRecordString(messageRecord, 'splitSourceMessageId'),
        splitTailMessageId: readRecordString(messageRecord, 'splitTailMessageId')
      })
    }
  }

  topChatSessions.sort(
    (a, b) =>
      (readRecordNumber(b, 'estimatedPartStringChars') ?? 0) -
        (readRecordNumber(a, 'estimatedPartStringChars') ?? 0) ||
      (readRecordNumber(b, 'partCount') ?? 0) - (readRecordNumber(a, 'partCount') ?? 0)
  )
  activeStreamingMessages.sort(
    (a, b) =>
      (readRecordNumber(b, 'estimatedPartStringChars') ?? 0) -
        (readRecordNumber(a, 'estimatedPartStringChars') ?? 0) ||
      (readRecordNumber(b, 'partCount') ?? 0) - (readRecordNumber(a, 'partCount') ?? 0)
  )
  runDisplayMetaMessages.sort(
    (a, b) =>
      Number(readRecordNumber(a, 'completedAtMs') !== null) -
        Number(readRecordNumber(b, 'completedAtMs') !== null) ||
      (readRecordNumber(b, 'partCount') ?? 0) - (readRecordNumber(a, 'partCount') ?? 0)
  )
  rendererWindows.sort(
    (a, b) =>
      (readRecordNumber(b, 'usedJSHeapSize') ?? 0) - (readRecordNumber(a, 'usedJSHeapSize') ?? 0)
  )

  return {
    rendererWindows: rendererWindows.slice(0, TOP_DRILLDOWN_LIMIT),
    topChatSessions: topChatSessions.slice(0, TOP_DRILLDOWN_LIMIT),
    activeStreamingMessages: activeStreamingMessages.slice(0, TOP_DRILLDOWN_LIMIT),
    runDisplayMetaMessages: runDisplayMetaMessages.slice(0, TOP_DRILLDOWN_LIMIT)
  }
}

function summarizeBrowserPanelDrilldowns(latestDesktopSample: Record<string, unknown> | undefined) {
  const diagnostics = latestDesktopSample
    ? readNestedRecord(latestDesktopSample, 'diagnostics')
    : undefined
  const browser = readNestedRecord(diagnostics ?? {}, 'browser')
  const panel = readNestedRecord(browser ?? {}, 'panel')
  const limits = readNestedRecord(browser ?? {}, 'limits')
  const threads = readNestedArray(browser ?? {}, 'threads').filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object' && !Array.isArray(item)
  )
  const runtimes = readNestedArray(browser ?? {}, 'runtimes').filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object' && !Array.isArray(item)
  )

  const activeThreads = threads
    .filter(
      (thread) =>
        readRecordBoolean(thread, 'open') === true ||
        readRecordBoolean(thread, 'active') === true ||
        (readRecordNumber(thread, 'tabCount') ?? 0) > 0 ||
        (readRecordNumber(thread, 'runtimeCount') ?? 0) > 0
    )
    .slice(0, TOP_DRILLDOWN_LIMIT)

  const liveTabs = activeThreads
    .flatMap((thread) => {
      const tabs = readNestedArray(thread, 'tabs').filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item)
      )
      return tabs
        .filter(
          (tab) =>
            readRecordBoolean(tab, 'hasRuntime') === true ||
            readRecordBoolean(tab, 'active') === true
        )
        .map((tab) => ({
          threadId: readRecordString(thread, 'threadId'),
          tabId: readRecordString(tab, 'id'),
          status: readRecordString(tab, 'status'),
          active: readRecordBoolean(tab, 'active'),
          loading: readRecordBoolean(tab, 'loading'),
          hasRuntime: readRecordBoolean(tab, 'hasRuntime'),
          webContentsId: readRecordNumber(tab, 'webContentsId'),
          chromiumProcessId: readRecordNumber(tab, 'chromiumProcessId'),
          osProcessId: readRecordNumber(tab, 'osProcessId'),
          url: readRecordString(tab, 'url'),
          title: readRecordString(tab, 'title'),
          lastCommittedUrl: readRecordString(tab, 'lastCommittedUrl'),
          lastError: readRecordString(tab, 'lastError')
        }))
    })
    .slice(0, TOP_DRILLDOWN_LIMIT)

  return {
    panel: panel ?? null,
    limits: limits ?? null,
    activeThreads,
    liveTabs,
    runtimes: runtimes.slice(0, TOP_DRILLDOWN_LIMIT)
  }
}

function summarizeReplayDrilldowns(
  activeRuns: ChatRuntime.ActiveRunSummary[],
  replayBuffers: ChatRuntime.ActiveRunReplayBufferSummary[]
) {
  const runById = new Map(activeRuns.map((run) => [run.runId, run]))
  return replayBuffers
    .map((buffer) => {
      const run = runById.get(buffer.runId)
      return {
        ...buffer,
        sessionId: run?.sessionId ?? null,
        messageId: run?.messageId ?? null,
        providerTargetKind: run?.providerTargetKind ?? null,
        providerTargetId: run?.providerTargetId ?? null,
        modelId: run?.modelId ?? null
      }
    })
    .sort((a, b) => b.chunkCount - a.chunkCount || b.maxDeltaChars - a.maxDeltaChars)
    .slice(0, TOP_DRILLDOWN_LIMIT)
}

function summarizeProviderHostDrilldowns(
  hosts: ReturnType<typeof providerRuntimeHostManager.listHosts>
) {
  const now = Date.now()
  return hosts
    .map((host) => ({
      ...host,
      expiresInMs: host.expiresAt - now,
      idleForMs: now - host.updatedAt
    }))
    .sort(
      (a, b) =>
        b.refCount - a.refCount ||
        b.pinnedCount - a.pinnedCount ||
        Number(b.hasResource) - Number(a.hasResource) ||
        b.idleForMs - a.idleForMs
    )
    .slice(0, TOP_DRILLDOWN_LIMIT)
}

export async function getRuntimeSnapshot() {
  const health = Health.check()
  const memory = process.memoryUsage()
  const activeRuns = ChatRuntime.listActiveRunSummaries()
  const replayBuffers = activeRuns
    .map((run) => ChatRuntime.getActiveRunReplayBufferSummary(run.runId))
    .filter((item) => item !== null)
  const providerHosts = providerRuntimeHostManager.listHosts()
  const pty = await Pty.listResources()
  const chronicle = getDaemonResources()
  const opencodeServer = getOpencodeServerResources()
  const observability = getQueueHealth()
  const desktop = {
    latestSamples: getDesktopRuntimeSamples()
  }

  const activeRunsByRuntimeKind: Record<string, number> = {}
  const replayBufferChunksByRuntimeKind: Record<string, number> = {}
  const replayTextDeltasByRuntimeKind: Record<string, number> = {}
  const replayReasoningDeltasByRuntimeKind: Record<string, number> = {}
  const replayToolDeltasByRuntimeKind: Record<string, number> = {}
  for (const run of activeRuns) {
    const runtimeKind = run.providerTargetKind ?? 'unknown'
    incrementBucket(activeRunsByRuntimeKind, runtimeKind)
    const replay = replayBuffers.find((item) => item.runId === run.runId)
    if (replay) {
      incrementBucket(replayBufferChunksByRuntimeKind, runtimeKind, replay.chunkCount)
      incrementBucket(replayTextDeltasByRuntimeKind, runtimeKind, replay.textDeltaCount)
      incrementBucket(replayReasoningDeltasByRuntimeKind, runtimeKind, replay.reasoningDeltaCount)
      incrementBucket(
        replayToolDeltasByRuntimeKind,
        runtimeKind,
        replay.toolInputDeltaCount + replay.toolOutputCount
      )
    }
  }

  const hostsByRuntimeKind: Record<string, number> = {}
  const resourceHostsByRuntimeKind: Record<string, number> = {}
  const refCountsByRuntimeKind: Record<string, number> = {}
  const pinnedCountsByRuntimeKind: Record<string, number> = {}
  for (const host of providerHosts) {
    incrementBucket(hostsByRuntimeKind, host.runtimeKind)
    if (host.hasResource) {
      incrementBucket(resourceHostsByRuntimeKind, host.runtimeKind)
    }
    incrementBucket(refCountsByRuntimeKind, host.runtimeKind, host.refCount)
    incrementBucket(pinnedCountsByRuntimeKind, host.runtimeKind, host.pinnedCount)
  }

  const serverMemory = {
    rssMB: toMB(memory.rss),
    heapUsedMB: toMB(memory.heapUsed),
    heapTotalMB: toMB(memory.heapTotal),
    externalMB: toMB(memory.external),
    arrayBuffersMB: toMB(memory.arrayBuffers)
  }
  const activeHandles = readActiveResourceCount('_getActiveHandles')
  const activeRequests = readActiveResourceCount('_getActiveRequests')

  const terminalCountByRole: Record<string, number> = {}
  const descendantCountByRole: Record<string, number> = {}
  for (const terminal of pty.terminals) {
    incrementBucket(terminalCountByRole, terminal.role)
    incrementBucket(descendantCountByRole, terminal.role, terminal.descendantCount ?? 0)
  }

  const latestDesktopSample = desktop.latestSamples.at(-1)
  const latestDesktopSampleRecord = latestDesktopSample as unknown as
    | Record<string, unknown>
    | undefined
  const appProcessCountByType: Record<string, number> = {}
  const appProcessMemoryBytesByType: Record<string, number> = {}
  for (const metric of latestDesktopSample?.appMetrics ?? []) {
    const type = typeof metric.type === 'string' && metric.type.length > 0 ? metric.type : 'unknown'
    incrementBucket(appProcessCountByType, type)
    const memory = readNestedRecord(metric, 'memory')
    const workingSetBytes = toBytesFromKiB(readRecordNumber(memory, 'workingSetSize'))
    if (workingSetBytes !== null) {
      incrementBucket(appProcessMemoryBytesByType, type, workingSetBytes)
    }
  }
  const mainMemory = readNestedRecord(latestDesktopSample?.main ?? {}, 'memory')
  const mainMemoryBytesByKind: Record<string, number> = {}
  for (const key of ['workingSetSize', 'peakWorkingSetSize', 'privateBytes', 'sharedBytes']) {
    const bytes = toBytesFromKiB(readRecordNumber(mainMemory, key))
    if (bytes !== null) {
      mainMemoryBytesByKind[key] = bytes
    }
  }
  const rendererMemoryBytesByKind: Record<string, number> = {}
  const rendererChatStoreTotals: Record<string, number> = {}
  const rendererDocumentTotals: Record<string, number> = {}
  const rendererPerformanceTotals: Record<string, number> = {}
  const diagnostics = latestDesktopSampleRecord
    ? readNestedRecord(latestDesktopSampleRecord, 'diagnostics')
    : undefined
  for (const item of readNestedArray(diagnostics ?? {}, 'renderers')) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue
    }
    const renderer = readNestedRecord(item as Record<string, unknown>, 'renderer')
    if (!renderer) {
      continue
    }
    const rendererMemory = readNestedRecord(renderer, 'rendererMemory')
    const currentMemory = readNestedRecord(rendererMemory ?? {}, 'current')
    for (const key of ['usedJSHeapSize', 'totalJSHeapSize', 'jsHeapSizeLimit']) {
      const value = readRecordNumber(currentMemory, key)
      if (value !== null) {
        incrementBucket(rendererMemoryBytesByKind, key, value)
      }
    }

    const chatStore = readNestedRecord(renderer, 'chatStore')
    const totals = readNestedRecord(chatStore ?? {}, 'totals')
    for (const [key, value] of Object.entries(totals ?? {})) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        incrementBucket(rendererChatStoreTotals, key, value)
      }
    }

    const documentMetrics = readNestedRecord(renderer, 'document')
    for (const [key, value] of Object.entries(documentMetrics ?? {})) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        incrementBucket(rendererDocumentTotals, key, value)
      }
    }

    const longTasks = readNestedArray(rendererMemory ?? {}, 'longTasks')
    const paints = readNestedArray(rendererMemory ?? {}, 'paints')
    incrementBucket(rendererPerformanceTotals, 'longTaskCount', longTasks.length)
    incrementBucket(rendererPerformanceTotals, 'paintCount', paints.length)
    for (const item of longTasks) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        continue
      }
      const duration = readRecordNumber(item as Record<string, unknown>, 'duration')
      if (duration !== null) {
        incrementBucket(rendererPerformanceTotals, 'longTaskDurationMs', duration)
      }
    }
  }

  updateServerProcessMetrics({
    ...serverMemory,
    cpuPercent: health.cpu.percent,
    uptimeSeconds: health.uptime,
    activeHandles,
    activeRequests
  })
  updateChatRuntimeMetrics({
    activeRunsByRuntimeKind,
    replayBufferChunksByRuntimeKind,
    replayTextDeltasByRuntimeKind,
    replayReasoningDeltasByRuntimeKind,
    replayToolDeltasByRuntimeKind
  })
  updateProviderRuntimeMetrics({
    hostsByRuntimeKind,
    resourceHostsByRuntimeKind,
    refCountsByRuntimeKind,
    pinnedCountsByRuntimeKind
  })
  updatePtyMetrics({
    terminalCountByRole,
    rssMBByRole: {
      'cli-tui': pty.totals.cliTuiRssMB,
      'bottom-panel': pty.totals.bottomPanelRssMB
    },
    cpuPercentByRole: {
      'cli-tui': pty.totals.cliTuiCpuPercent,
      'bottom-panel': pty.totals.bottomPanelCpuPercent
    },
    descendantCountByRole
  })
  updateChronicleMetrics(chronicle)
  updateOpencodeServerMetrics({
    running: opencodeServer.running,
    pid: opencodeServer.pid,
    uptimeSeconds: opencodeServer.uptimeSeconds,
    rssMB: opencodeServer.rssMB,
    cpuPercent: opencodeServer.cpuPercent
  })
  updateDesktopMetrics({
    latestSampleAgeMs: latestDesktopSample ? Date.now() - latestDesktopSample.sampledAt : null,
    windowCount: latestDesktopSample?.windows.length ?? 0,
    appProcessCountByType,
    appProcessMemoryBytesByType,
    mainMemoryBytesByKind,
    rendererMemoryBytesByKind,
    rendererChatStoreTotals,
    rendererDocumentTotals,
    rendererPerformanceTotals
  })
  updateObservabilityMetrics(observability)

  const drilldowns = {
    renderer: summarizeRendererDrilldowns(latestDesktopSampleRecord),
    browserPanel: summarizeBrowserPanelDrilldowns(latestDesktopSampleRecord),
    replay: {
      topRuns: summarizeReplayDrilldowns(activeRuns, replayBuffers)
    },
    providerRuntime: {
      topHosts: summarizeProviderHostDrilldowns(providerHosts)
    }
  }

  return {
    timestamp: Date.now(),
    server: {
      pid: process.pid,
      uptimeSeconds: health.uptime,
      memory: serverMemory,
      cpu: health.cpu,
      node: {
        activeHandles,
        activeRequests
      }
    },
    chatRuntime: {
      activeRuns,
      replayBuffers
    },
    providerRuntime: {
      hosts: providerHosts
    },
    pty,
    chronicle,
    opencodeServer,
    desktop,
    drilldowns,
    observability
  }
}
