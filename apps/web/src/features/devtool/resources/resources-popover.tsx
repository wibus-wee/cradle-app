import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import {
  getChronicleDaemonResourcesOptions,
  getChronicleStatusOptions,
  getCodexAppServerResourcesOptions,
  getFabricManagedRelayResourcesOptions,
  getHealthOptions,
  getKimiServerResourcesOptions,
  getOpencodeServerResourcesOptions,
  getTerminalSessionsResourcesOptions,
} from '~/api-gen/@tanstack/react-query.gen'
import type {
  GetChronicleDaemonResourcesResponse,
  GetChronicleStatusResponse,
  GetCodexAppServerResourcesResponse,
  GetFabricManagedRelayResourcesResponse,
  GetHealthResponse,
  GetKimiServerResourcesResponse,
  GetOpencodeServerResourcesResponse,
  GetTerminalSessionsResourcesResponse,
} from '~/api-gen/types.gen'

import type { ResourceSnapshot } from './resources-popover-view'
import { ResourcesPopoverView } from './resources-popover-view'

const REFRESH_INTERVAL_MS = 3000
const SUMMARY_REFRESH_INTERVAL_MS = 15000

type ServerHealth = GetHealthResponse
type PtyResources = GetTerminalSessionsResourcesResponse
type ChronicleResources = GetChronicleDaemonResourcesResponse
type OpencodeServerResources = GetOpencodeServerResourcesResponse[number]
type KimiServerResources = GetKimiServerResourcesResponse[number]
type CodexAppServerResources = GetCodexAppServerResourcesResponse[number]
type ManagedRelayResources = GetFabricManagedRelayResourcesResponse

interface RendererMemory { heapUsed: number, heapTotal: number, heapLimit: number }

interface ResourceSnapshotInput {
  renderer: RendererMemory
  server: ServerHealth | null
  pty: PtyResources | null
  chronicle: ChronicleResources | null
  chronicleWarning: string | null
  opencode: OpencodeServerResources[] | null
  opencodeWarning: string | null
  kimi: KimiServerResources[] | null
  kimiWarning: string | null
  codexAppServer: CodexAppServerResources[] | null
  codexAppServerWarning: string | null
  relay: ManagedRelayResources | null
  relayWarning: string | null
  timestamp: number
}

const CHRONICLE_OFF_RESOURCES: ChronicleResources = {
  running: false,
  pid: null,
  rssMB: null,
  cpuPercent: null,
}

function readRendererMemory(): RendererMemory {
  if (typeof performance === 'undefined' || !('memory' in performance)) {
    return { heapUsed: 0, heapTotal: 0, heapLimit: 0 }
  }
  const memory = performance.memory as {
    usedJSHeapSize?: number
    totalJSHeapSize?: number
    jsHeapSizeLimit?: number
  }
  return {
    heapUsed: memory.usedJSHeapSize ?? 0,
    heapTotal: memory.totalJSHeapSize ?? 0,
    heapLimit: memory.jsHeapSizeLimit ?? 0,
  }
}

function createResourceSnapshot(input: ResourceSnapshotInput): ResourceSnapshot {
  const mbToBytes = (megabytes: number) => megabytes * 1024 * 1024
  const warnings = [
    input.server ? null : 'Server metrics unavailable',
    input.pty ? null : 'Terminal resource metrics unavailable',
    input.chronicleWarning,
    input.opencodeWarning,
    input.kimiWarning,
    input.codexAppServerWarning,
    input.relayWarning,
  ].filter((warning): warning is string => warning !== null)
  const sumRss = (resources: Array<{ rssMB: number | null }> | null) =>
    resources?.reduce((total, resource) => total + (resource.rssMB ?? 0), 0) ?? 0
  const sumCpu = (resources: Array<{ cpuPercent: number | null }> | null) => resources
    ? resources.reduce<number | null>(
        (total, resource) => resource.cpuPercent === null ? total : (total ?? 0) + resource.cpuPercent,
        null,
      )
    : null

  return {
    rendererHeapUsed: input.renderer.heapUsed,
    rendererHeapTotal: input.renderer.heapTotal,
    rendererHeapLimit: input.renderer.heapLimit,
    serverRss: input.server ? mbToBytes(input.server.memory.rss) : 0,
    serverHeapUsed: input.server ? mbToBytes(input.server.memory.heapUsed) : 0,
    serverHeapTotal: input.server ? mbToBytes(input.server.memory.heapTotal) : 0,
    serverExternal: input.server ? mbToBytes(input.server.memory.external) : 0,
    serverCpuPercent: input.server?.cpu?.percent ?? null,
    serverUptime: input.server?.uptime ?? 0,
    cliTuiRss: input.pty ? mbToBytes(input.pty.totals.cliTuiRssMB) : 0,
    cliTuiCpuPercent: input.pty?.totals.cliTuiCpuPercent ?? 0,
    bottomPanelRss: input.pty ? mbToBytes(input.pty.totals.bottomPanelRssMB) : 0,
    bottomPanelCpuPercent: input.pty?.totals.bottomPanelCpuPercent ?? 0,
    chronicleRunning: input.chronicle?.running ?? false,
    chroniclePid: input.chronicle?.pid ?? null,
    chronicleRss: input.chronicle?.rssMB ? mbToBytes(input.chronicle.rssMB) : 0,
    chronicleCpuPercent: input.chronicle?.cpuPercent ?? null,
    opencodeRunning: input.opencode?.some(resource => resource.running) ?? false,
    opencodeRss: mbToBytes(sumRss(input.opencode)),
    opencodeCpuPercent: sumCpu(input.opencode),
    opencodeUptime: input.opencode?.reduce((latest, resource) => Math.max(latest, resource.uptimeSeconds ?? 0), 0) ?? 0,
    opencodeResources: input.opencode ?? [],
    kimiRunning: input.kimi?.some(resource => resource.running) ?? false,
    kimiRss: mbToBytes(sumRss(input.kimi)),
    kimiCpuPercent: sumCpu(input.kimi),
    kimiResources: input.kimi ?? [],
    codexAppServerRunning: input.codexAppServer?.some(resource => resource.running) ?? false,
    codexAppServerRss: mbToBytes(sumRss(input.codexAppServer)),
    codexAppServerCpuPercent: sumCpu(input.codexAppServer),
    codexAppServerResources: input.codexAppServer ?? [],
    relaySource: input.relay?.source ?? 'unavailable',
    relayRunning: input.relay?.running ?? false,
    relayPid: input.relay?.pid ?? null,
    relayRss: input.relay?.rssMB ? mbToBytes(input.relay.rssMB) : 0,
    relayCpuPercent: input.relay?.cpuPercent ?? null,
    terminals: input.pty?.terminals ?? [],
    timestamp: input.timestamp,
    updatedAtLabel: new Date(input.timestamp).toLocaleTimeString('en-US', { hour12: false }),
    warnings,
  }
}

function useResourceSnapshot(open: boolean) {
  const [renderer, setRenderer] = useState(readRendererMemory)
  const [timestamp, setTimestamp] = useState(Date.now)
  const health = useQuery({
    ...getHealthOptions(),
    refetchInterval: open ? REFRESH_INTERVAL_MS : SUMMARY_REFRESH_INTERVAL_MS,
  })
  const pty = useQuery({
    ...getTerminalSessionsResourcesOptions(),
    enabled: open,
    refetchInterval: REFRESH_INTERVAL_MS,
  })
  const chronicleStatus = useQuery({
    ...getChronicleStatusOptions(),
    select: (data: GetChronicleStatusResponse) => ({ running: data.running }),
    enabled: open,
    refetchInterval: query => open && query.state.status !== 'error' ? REFRESH_INTERVAL_MS : false,
    retry: false,
  })
  const chronicleResourcesEnabled = open && chronicleStatus.data?.running === true
  const chronicle = useQuery({
    ...getChronicleDaemonResourcesOptions(),
    enabled: chronicleResourcesEnabled,
    refetchInterval: query => chronicleResourcesEnabled && query.state.status !== 'error' ? REFRESH_INTERVAL_MS : false,
    retry: false,
  })
  const opencode = useQuery({
    ...getOpencodeServerResourcesOptions(),
    enabled: open,
    refetchInterval: query => open && query.state.status !== 'error' ? REFRESH_INTERVAL_MS : false,
    retry: false,
  })
  const kimi = useQuery({
    ...getKimiServerResourcesOptions(),
    enabled: open,
    refetchInterval: query => open && query.state.status !== 'error' ? REFRESH_INTERVAL_MS : false,
    retry: false,
  })
  const codex = useQuery({
    ...getCodexAppServerResourcesOptions(),
    enabled: open,
    refetchInterval: query => open && query.state.status !== 'error' ? REFRESH_INTERVAL_MS : false,
    retry: false,
  })
  const relay = useQuery({
    ...getFabricManagedRelayResourcesOptions(),
    refetchInterval: query => query.state.status !== 'error'
      ? open ? REFRESH_INTERVAL_MS : SUMMARY_REFRESH_INTERVAL_MS
      : false,
    retry: false,
  })

  useEffect(() => {
    if (!open) {
      return
    }
    const refreshRenderer = () => {
      setRenderer(readRendererMemory())
      setTimestamp(Date.now())
    }
    refreshRenderer()
    const intervalId = setInterval(refreshRenderer, REFRESH_INTERVAL_MS)
    return () => clearInterval(intervalId)
  }, [open])

  const refresh = async () => {
    setRenderer(readRendererMemory())
    setTimestamp(Date.now())
    const refetches: Array<Promise<unknown>> = [health.refetch(), relay.refetch()]
    if (open) {
      refetches.push(pty.refetch(), chronicleStatus.refetch(), opencode.refetch(), kimi.refetch(), codex.refetch())
    }
    if (chronicleResourcesEnabled) {
      refetches.push(chronicle.refetch())
    }
    await Promise.all(refetches)
  }

  const hasSnapshot = health.isFetched
    || relay.isFetched
    || pty.isFetched
    || chronicleStatus.isFetched
    || chronicle.isFetched
    || opencode.isFetched
    || kimi.isFetched
    || codex.isFetched
  const chronicleWarning = chronicleStatus.isError
    ? 'Chronicle status unavailable'
    : chronicleResourcesEnabled && chronicle.isError ? 'Chronicle daemon metrics unavailable' : null
  const snapshot = hasSnapshot
    ? createResourceSnapshot({
        renderer,
        server: health.data ?? null,
        pty: pty.data ?? null,
        chronicle: chronicleResourcesEnabled ? chronicle.data ?? null : CHRONICLE_OFF_RESOURCES,
        chronicleWarning,
        opencode: open ? opencode.data ?? null : [],
        opencodeWarning: open && opencode.isError ? 'opencode server metrics unavailable' : null,
        kimi: open ? kimi.data ?? null : [],
        kimiWarning: open && kimi.isError ? 'kimi server metrics unavailable' : null,
        codexAppServer: open ? codex.data ?? null : [],
        codexAppServerWarning: open && codex.isError ? 'codex app-server metrics unavailable' : null,
        relay: relay.data ?? null,
        relayWarning: relay.isError ? 'Relay process metrics unavailable' : null,
        timestamp,
      })
    : null
  const loading = health.isFetching
    || relay.isFetching
    || pty.isFetching
    || chronicleStatus.isFetching
    || (chronicleResourcesEnabled && chronicle.isFetching)
    || opencode.isFetching
    || kimi.isFetching
    || codex.isFetching
  const resourcesReady = health.isSuccess
    && relay.isSuccess
    && pty.isSuccess
    && chronicleStatus.isSuccess
    && (!chronicleResourcesEnabled || chronicle.isSuccess)
    && opencode.isSuccess
    && kimi.isSuccess
    && codex.isSuccess

  return { snapshot, loading, refresh, resourcesReady }
}

export function ResourcesPopover() {
  const [open, setOpen] = useState(false)
  const { snapshot, loading, refresh, resourcesReady } = useResourceSnapshot(open)

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) {
      void refresh()
    }
  }

  return (
    <ResourcesPopoverView
      open={open}
      snapshot={snapshot}
      loading={loading}
      resourcesReady={resourcesReady}
      onOpenChange={handleOpenChange}
      onRefresh={() => void refresh()}
    />
  )
}
