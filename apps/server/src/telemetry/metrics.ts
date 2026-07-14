import { metrics } from '@opentelemetry/api'

let initialized = false

export interface ServerProcessMetricSnapshot {
  rssMB: number
  heapUsedMB: number
  heapTotalMB: number
  externalMB: number
  arrayBuffersMB: number
  cpuPercent: number | null
  uptimeSeconds: number
  activeHandles: number
  activeRequests: number
}

export interface ChatRuntimeMetricSnapshot {
  activeRunsByRuntimeKind: Record<string, number>
  replayBufferChunksByRuntimeKind: Record<string, number>
  replayTextDeltasByRuntimeKind: Record<string, number>
  replayReasoningDeltasByRuntimeKind: Record<string, number>
  replayToolDeltasByRuntimeKind: Record<string, number>
}

export interface ProviderRuntimeMetricSnapshot {
  hostsByRuntimeKind: Record<string, number>
  resourceHostsByRuntimeKind: Record<string, number>
  refCountsByRuntimeKind: Record<string, number>
  pinnedCountsByRuntimeKind: Record<string, number>
}

export interface PtyMetricSnapshot {
  terminalCountByRole: Record<string, number>
  rssMBByRole: Record<string, number>
  cpuPercentByRole: Record<string, number>
  descendantCountByRole: Record<string, number>
}

export interface ChronicleMetricSnapshot {
  running: boolean
  rssMB: number | null
  cpuPercent: number | null
}

export interface OpencodeServerMetricSnapshot {
  running: boolean
  pid: number | null
  uptimeSeconds: number | null
  rssMB: number | null
  cpuPercent: number | null
}

export interface ObservabilityMetricSnapshot {
  queueDepth: number
  recentEvents: number
  droppedEvents: number
  pendingFlush: boolean
}

export interface DesktopMetricSnapshot {
  latestSampleAgeMs: number | null
  windowCount: number
  appProcessCountByType: Record<string, number>
  appProcessMemoryBytesByType: Record<string, number>
  mainMemoryBytesByKind: Record<string, number>
  rendererMemoryBytesByKind: Record<string, number>
  rendererChatStoreTotals: Record<string, number>
  rendererDocumentTotals: Record<string, number>
  rendererPerformanceTotals: Record<string, number>
}

let serverProcessSnapshot: ServerProcessMetricSnapshot | null = null
let chatRuntimeSnapshot: ChatRuntimeMetricSnapshot | null = null
let providerRuntimeSnapshot: ProviderRuntimeMetricSnapshot | null = null
let ptySnapshot: PtyMetricSnapshot | null = null
let chronicleSnapshot: ChronicleMetricSnapshot | null = null
let opencodeServerSnapshot: OpencodeServerMetricSnapshot | null = null
let observabilitySnapshot: ObservabilityMetricSnapshot | null = null
let desktopSnapshot: DesktopMetricSnapshot | null = null

let recordDroppedEvents: ((count: number) => void) | null = null

export function initializeCradleMetrics(): void {
  if (initialized) {
    return
  }
  initialized = true

  const meter = metrics.getMeter('cradle-server')
  const droppedEventsCounter = meter.createCounter('cradle_observability_events_dropped_total', {
    description: 'Number of observability events dropped before durable persistence.',
  })
  recordDroppedEvents = count => droppedEventsCounter.add(count)

  const processMemoryGauge = meter.createObservableGauge('cradle_process_memory_bytes', {
    description: 'Cradle server process memory usage in bytes.',
  })
  processMemoryGauge.addCallback((result) => {
    if (!serverProcessSnapshot) {
      return
    }
    result.observe(serverProcessSnapshot.rssMB * 1024 * 1024, { process: 'server', kind: 'rss' })
    result.observe(serverProcessSnapshot.heapUsedMB * 1024 * 1024, { process: 'server', kind: 'heap_used' })
    result.observe(serverProcessSnapshot.heapTotalMB * 1024 * 1024, { process: 'server', kind: 'heap_total' })
    result.observe(serverProcessSnapshot.externalMB * 1024 * 1024, { process: 'server', kind: 'external' })
    result.observe(serverProcessSnapshot.arrayBuffersMB * 1024 * 1024, { process: 'server', kind: 'array_buffers' })
  })

  const processCpuGauge = meter.createObservableGauge('cradle_process_cpu_percent', {
    description: 'Cradle server process CPU percent.',
  })
  processCpuGauge.addCallback((result) => {
    if (serverProcessSnapshot?.cpuPercent !== null && serverProcessSnapshot?.cpuPercent !== undefined) {
      result.observe(serverProcessSnapshot.cpuPercent, { process: 'server' })
    }
  })

  const processUptimeGauge = meter.createObservableGauge('cradle_process_uptime_seconds', {
    description: 'Cradle server process uptime in seconds.',
  })
  processUptimeGauge.addCallback((result) => {
    if (serverProcessSnapshot) {
      result.observe(serverProcessSnapshot.uptimeSeconds, { process: 'server' })
    }
  })

  const processActiveResourcesGauge = meter.createObservableGauge('cradle_process_active_resources_total', {
    description: 'Cradle server active Node handles and requests.',
  })
  processActiveResourcesGauge.addCallback((result) => {
    if (!serverProcessSnapshot) {
      return
    }
    result.observe(serverProcessSnapshot.activeHandles, { process: 'server', kind: 'handles' })
    result.observe(serverProcessSnapshot.activeRequests, { process: 'server', kind: 'requests' })
  })

  const activeRunsGauge = meter.createObservableGauge('cradle_chat_active_runs_total', {
    description: 'Current active chat runs grouped by runtime kind.',
  })
  activeRunsGauge.addCallback((result) => {
    for (const [runtimeKind, count] of Object.entries(chatRuntimeSnapshot?.activeRunsByRuntimeKind ?? {})) {
      result.observe(count, { runtime_kind: runtimeKind })
    }
  })

  const replayBufferGauge = meter.createObservableGauge('cradle_chat_replay_buffer_chunks', {
    description: 'Current active chat replay buffer chunks grouped by runtime kind.',
  })
  replayBufferGauge.addCallback((result) => {
    for (const [runtimeKind, count] of Object.entries(chatRuntimeSnapshot?.replayBufferChunksByRuntimeKind ?? {})) {
      result.observe(count, { runtime_kind: runtimeKind })
    }
  })

  const replayBufferDeltaGauge = meter.createObservableGauge('cradle_chat_replay_buffer_deltas', {
    description: 'Current active chat replay buffer delta counts grouped by runtime kind and delta kind.',
  })
  replayBufferDeltaGauge.addCallback((result) => {
    for (const [runtimeKind, count] of Object.entries(chatRuntimeSnapshot?.replayTextDeltasByRuntimeKind ?? {})) {
      result.observe(count, { runtime_kind: runtimeKind, kind: 'text' })
    }
    for (const [runtimeKind, count] of Object.entries(chatRuntimeSnapshot?.replayReasoningDeltasByRuntimeKind ?? {})) {
      result.observe(count, { runtime_kind: runtimeKind, kind: 'reasoning' })
    }
    for (const [runtimeKind, count] of Object.entries(chatRuntimeSnapshot?.replayToolDeltasByRuntimeKind ?? {})) {
      result.observe(count, { runtime_kind: runtimeKind, kind: 'tool' })
    }
  })

  const providerHostsGauge = meter.createObservableGauge('cradle_provider_runtime_hosts_total', {
    description: 'Current provider runtime host count grouped by runtime kind.',
  })
  providerHostsGauge.addCallback((result) => {
    for (const [runtimeKind, count] of Object.entries(providerRuntimeSnapshot?.hostsByRuntimeKind ?? {})) {
      result.observe(count, { runtime_kind: runtimeKind })
    }
  })

  const providerHostStateGauge = meter.createObservableGauge('cradle_provider_runtime_host_state_total', {
    description: 'Provider runtime host state counts grouped by runtime kind.',
  })
  providerHostStateGauge.addCallback((result) => {
    for (const [runtimeKind, count] of Object.entries(providerRuntimeSnapshot?.resourceHostsByRuntimeKind ?? {})) {
      result.observe(count, { runtime_kind: runtimeKind, kind: 'has_resource' })
    }
    for (const [runtimeKind, count] of Object.entries(providerRuntimeSnapshot?.refCountsByRuntimeKind ?? {})) {
      result.observe(count, { runtime_kind: runtimeKind, kind: 'ref_count' })
    }
    for (const [runtimeKind, count] of Object.entries(providerRuntimeSnapshot?.pinnedCountsByRuntimeKind ?? {})) {
      result.observe(count, { runtime_kind: runtimeKind, kind: 'pinned_count' })
    }
  })

  const ptyTerminalGauge = meter.createObservableGauge('cradle_pty_sessions_total', {
    description: 'Current terminal session count grouped by terminal role.',
  })
  ptyTerminalGauge.addCallback((result) => {
    for (const [role, count] of Object.entries(ptySnapshot?.terminalCountByRole ?? {})) {
      result.observe(count, { role })
    }
  })

  const ptyRssGauge = meter.createObservableGauge('cradle_pty_rss_bytes', {
    description: 'Terminal process tree RSS grouped by terminal role.',
  })
  ptyRssGauge.addCallback((result) => {
    for (const [role, rssMB] of Object.entries(ptySnapshot?.rssMBByRole ?? {})) {
      result.observe(rssMB * 1024 * 1024, { role })
    }
  })

  const ptyCpuGauge = meter.createObservableGauge('cradle_pty_cpu_percent', {
    description: 'Terminal process tree CPU percent grouped by terminal role.',
  })
  ptyCpuGauge.addCallback((result) => {
    for (const [role, cpuPercent] of Object.entries(ptySnapshot?.cpuPercentByRole ?? {})) {
      result.observe(cpuPercent, { role })
    }
  })

  const ptyDescendantGauge = meter.createObservableGauge('cradle_pty_descendants_total', {
    description: 'Current terminal process descendants grouped by terminal role.',
  })
  ptyDescendantGauge.addCallback((result) => {
    for (const [role, count] of Object.entries(ptySnapshot?.descendantCountByRole ?? {})) {
      result.observe(count, { role })
    }
  })

  const chronicleRssGauge = meter.createObservableGauge('cradle_chronicle_daemon_rss_bytes', {
    description: 'Chronicle daemon process RSS in bytes.',
  })
  chronicleRssGauge.addCallback((result) => {
    if (chronicleSnapshot?.rssMB !== null && chronicleSnapshot?.rssMB !== undefined) {
      result.observe(chronicleSnapshot.rssMB * 1024 * 1024, { process: 'chronicle-daemon' })
    }
  })

  const chronicleStateGauge = meter.createObservableGauge('cradle_chronicle_daemon_state', {
    description: 'Chronicle daemon running state and CPU percent.',
  })
  chronicleStateGauge.addCallback((result) => {
    if (!chronicleSnapshot) {
      return
    }
    result.observe(chronicleSnapshot.running ? 1 : 0, { kind: 'running' })
    if (chronicleSnapshot.cpuPercent !== null) {
      result.observe(chronicleSnapshot.cpuPercent, { kind: 'cpu_percent' })
    }
  })

  const opencodeRssGauge = meter.createObservableGauge('cradle_opencode_server_rss_bytes', {
    description: 'One active pooled opencode host sample: process RSS in bytes.',
  })
  opencodeRssGauge.addCallback((result) => {
    if (opencodeServerSnapshot?.rssMB !== null && opencodeServerSnapshot?.rssMB !== undefined) {
      result.observe(opencodeServerSnapshot.rssMB * 1024 * 1024, { process: 'opencode-server' })
    }
  })

  const opencodeStateGauge = meter.createObservableGauge('cradle_opencode_server_state', {
    description: 'One active pooled opencode host sample: running state and CPU percent.',
  })
  opencodeStateGauge.addCallback((result) => {
    if (!opencodeServerSnapshot) {
      return
    }
    result.observe(opencodeServerSnapshot.running ? 1 : 0, { kind: 'running' })
    if (opencodeServerSnapshot.cpuPercent !== null) {
      result.observe(opencodeServerSnapshot.cpuPercent, { kind: 'cpu_percent' })
    }
  })

  const opencodeUptimeGauge = meter.createObservableGauge('cradle_opencode_server_uptime_seconds', {
    description: 'One active pooled opencode host sample: process uptime in seconds.',
  })
  opencodeUptimeGauge.addCallback((result) => {
    if (opencodeServerSnapshot?.uptimeSeconds !== null && opencodeServerSnapshot?.uptimeSeconds !== undefined) {
      result.observe(opencodeServerSnapshot.uptimeSeconds, { process: 'opencode-server' })
    }
  })

  const observabilityQueueGauge = meter.createObservableGauge('cradle_observability_queue_depth', {
    description: 'Current pending observability event queue depth.',
  })
  observabilityQueueGauge.addCallback((result) => {
    if (observabilitySnapshot) {
      result.observe(observabilitySnapshot.queueDepth)
    }
  })

  const observabilityStateGauge = meter.createObservableGauge('cradle_observability_state_total', {
    description: 'Current observability queue and recent event state.',
  })
  observabilityStateGauge.addCallback((result) => {
    if (!observabilitySnapshot) {
      return
    }
    result.observe(observabilitySnapshot.recentEvents, { kind: 'recent_events' })
    result.observe(observabilitySnapshot.droppedEvents, { kind: 'dropped_events' })
    result.observe(observabilitySnapshot.pendingFlush ? 1 : 0, { kind: 'pending_flush' })
  })

  const desktopWindowGauge = meter.createObservableGauge('cradle_desktop_windows_total', {
    description: 'Latest reported desktop BrowserWindow count.',
  })
  desktopWindowGauge.addCallback((result) => {
    if (desktopSnapshot) {
      result.observe(desktopSnapshot.windowCount)
    }
  })

  const desktopSampleAgeGauge = meter.createObservableGauge('cradle_desktop_sample_age_milliseconds', {
    description: 'Age of latest desktop runtime sample in milliseconds.',
  })
  desktopSampleAgeGauge.addCallback((result) => {
    if (desktopSnapshot?.latestSampleAgeMs !== null && desktopSnapshot?.latestSampleAgeMs !== undefined) {
      result.observe(desktopSnapshot.latestSampleAgeMs)
    }
  })

  const desktopProcessGauge = meter.createObservableGauge('cradle_desktop_processes_total', {
    description: 'Latest reported Electron process count grouped by process type.',
  })
  desktopProcessGauge.addCallback((result) => {
    for (const [type, count] of Object.entries(desktopSnapshot?.appProcessCountByType ?? {})) {
      result.observe(count, { type })
    }
  })

  const desktopMemoryGauge = meter.createObservableGauge('cradle_desktop_memory_bytes', {
    description: 'Latest reported Electron process memory grouped by process type and memory kind.',
  })
  desktopMemoryGauge.addCallback((result) => {
    for (const [kind, bytes] of Object.entries(desktopSnapshot?.mainMemoryBytesByKind ?? {})) {
      result.observe(bytes, { process: 'main', kind })
    }
    for (const [type, bytes] of Object.entries(desktopSnapshot?.appProcessMemoryBytesByType ?? {})) {
      result.observe(bytes, { process: type, kind: 'working_set' })
    }
  })

  const desktopRendererMemoryGauge = meter.createObservableGauge('cradle_desktop_renderer_memory_bytes', {
    description: 'Latest reported Electron renderer JS heap memory grouped by memory kind.',
  })
  desktopRendererMemoryGauge.addCallback((result) => {
    for (const [kind, bytes] of Object.entries(desktopSnapshot?.rendererMemoryBytesByKind ?? {})) {
      result.observe(bytes, { kind })
    }
  })

  const desktopRendererChatStoreGauge = meter.createObservableGauge('cradle_desktop_renderer_chat_store_total', {
    description: 'Latest reported renderer chat store telemetry totals grouped by kind.',
  })
  desktopRendererChatStoreGauge.addCallback((result) => {
    for (const [kind, count] of Object.entries(desktopSnapshot?.rendererChatStoreTotals ?? {})) {
      result.observe(count, { kind })
    }
  })

  const desktopRendererDocumentGauge = meter.createObservableGauge('cradle_desktop_renderer_document_total', {
    description: 'Latest reported renderer document and DOM telemetry totals grouped by kind.',
  })
  desktopRendererDocumentGauge.addCallback((result) => {
    for (const [kind, count] of Object.entries(desktopSnapshot?.rendererDocumentTotals ?? {})) {
      result.observe(count, { kind })
    }
  })

  const desktopRendererPerformanceGauge = meter.createObservableGauge('cradle_desktop_renderer_performance_total', {
    description: 'Latest reported renderer performance observer telemetry grouped by kind.',
  })
  desktopRendererPerformanceGauge.addCallback((result) => {
    for (const [kind, count] of Object.entries(desktopSnapshot?.rendererPerformanceTotals ?? {})) {
      result.observe(count, { kind })
    }
  })
}

export function updateServerProcessMetrics(snapshot: ServerProcessMetricSnapshot): void {
  serverProcessSnapshot = snapshot
}

export function updateChatRuntimeMetrics(snapshot: ChatRuntimeMetricSnapshot): void {
  chatRuntimeSnapshot = snapshot
}

export function updateProviderRuntimeMetrics(snapshot: ProviderRuntimeMetricSnapshot): void {
  providerRuntimeSnapshot = snapshot
}

export function updatePtyMetrics(snapshot: PtyMetricSnapshot): void {
  ptySnapshot = snapshot
}

export function updateChronicleMetrics(snapshot: ChronicleMetricSnapshot): void {
  chronicleSnapshot = snapshot
}

export function updateOpencodeServerMetrics(snapshot: OpencodeServerMetricSnapshot): void {
  opencodeServerSnapshot = snapshot
}

export function updateObservabilityMetrics(snapshot: ObservabilityMetricSnapshot): void {
  observabilitySnapshot = snapshot
}

export function updateDesktopMetrics(snapshot: DesktopMetricSnapshot): void {
  desktopSnapshot = snapshot
}

export function recordObservabilityDroppedEvents(count: number): void {
  if (count > 0) {
    recordDroppedEvents?.(count)
  }
}
