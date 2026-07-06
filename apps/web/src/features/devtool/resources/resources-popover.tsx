import {
  AlertLine as CircleAlertIcon,
  ChipLine as CpuIcon,
  HeartbeatLine as ActivityIcon,
  LayoutBottomLine as PanelBottomIcon,
  MonitorLine as MonitorIcon,
  Refresh1Line as RefreshCwIcon,
  ServerLine as ServerIcon,
  TerminalBoxLine as SquareTerminalIcon,
  UsbFlashDiskLine as MemoryStickIcon,
} from '@mingcute/react'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { z } from 'zod'

import {
  getChronicleDaemonResourcesOptions,
  getChronicleStatusOptions,
  getHealthOptions,
  getOpencodeServerResourcesOptions,
  getTerminalSessionsResourcesOptions,
} from '~/api-gen/@tanstack/react-query.gen'
import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Progress } from '~/components/ui/progress'
import { cn } from '~/lib/cn'
import {
  bytesToMegabytes,
  formatCpuPercent,
  formatMegabytes,
  formatResourceUsage,
  formatUptimeSeconds,
} from '~/lib/number-format'

const REFRESH_INTERVAL_MS = 3000
const SUMMARY_REFRESH_INTERVAL_MS = 15000
const PATH_SEGMENT_SEPARATOR_PATTERN = /[\\/]/

const ServerHealthSchema = z.looseObject({
  memory: z.object({
    heapUsed: z.number(),
    heapTotal: z.number(),
    rss: z.number(),
    external: z.number(),
  }),
  cpu: z.object({
    percent: z.number().nullable(),
    userMicros: z.number(),
    systemMicros: z.number(),
  }).optional(),
  uptime: z.number(),
})

const PtyResourceItemSchema = z.object({
  id: z.string(),
  role: z.enum(['cli-tui', 'bottom-panel']),
  pid: z.number(),
  executable: z.string(),
  cwd: z.string(),
  running: z.boolean(),
  startedAt: z.number(),
  cols: z.number(),
  rows: z.number(),
  rssMB: z.number().nullable(),
  cpuPercent: z.number().nullable().default(null),
  descendantCount: z.number().nullable(),
})

const PtyResourcesSchema = z.object({
  terminals: z.array(PtyResourceItemSchema),
  totals: z.object({
    cliTuiRssMB: z.number(),
    bottomPanelRssMB: z.number(),
    cliTuiCpuPercent: z.number().default(0),
    bottomPanelCpuPercent: z.number().default(0),
  }),
  timestamp: z.number(),
})

const ChronicleResourcesSchema = z.object({
  running: z.boolean(),
  pid: z.number().nullable(),
  rssMB: z.number().nullable(),
  cpuPercent: z.number().nullable().default(null),
})

const OpencodeServerResourcesSchema = z.object({
  running: z.boolean(),
  pid: z.number().nullable(),
  url: z.string().nullable(),
  startedAt: z.number().nullable(),
  uptimeSeconds: z.number().nullable(),
  rssMB: z.number().nullable(),
  cpuPercent: z.number().nullable().default(null),
})

export interface ServerHealth {
  memory: {
    heapUsed: number
    heapTotal: number
    rss: number
    external: number
  }
  cpu?: {
    percent: number | null
    userMicros: number
    systemMicros: number
  }
  uptime: number
}

export interface PtyResourceItem {
  id: string
  role: 'cli-tui' | 'bottom-panel'
  pid: number
  executable: string
  cwd: string
  running: boolean
  startedAt: number
  cols: number
  rows: number
  rssMB: number | null
  cpuPercent: number | null
  descendantCount: number | null
}

export interface PtyResources {
  terminals: PtyResourceItem[]
  totals: {
    cliTuiRssMB: number
    bottomPanelRssMB: number
    cliTuiCpuPercent: number
    bottomPanelCpuPercent: number
  }
  timestamp: number
}

interface ChronicleResources {
  running: boolean
  pid: number | null
  rssMB: number | null
  cpuPercent: number | null
}

interface ChronicleStatus {
  running: boolean
}

interface OpencodeServerResources {
  running: boolean
  pid: number | null
  url: string | null
  startedAt: number | null
  uptimeSeconds: number | null
  rssMB: number | null
  cpuPercent: number | null
}

interface RendererMemory {
  heapUsed: number
  heapTotal: number
  heapLimit: number
}

export interface ResourceSnapshot {
  rendererHeapUsed: number
  rendererHeapTotal: number
  rendererHeapLimit: number
  serverRss: number
  serverHeapUsed: number
  serverHeapTotal: number
  serverExternal: number
  serverCpuPercent: number | null
  serverUptime: number
  cliTuiRss: number
  cliTuiCpuPercent: number
  bottomPanelRss: number
  bottomPanelCpuPercent: number
  chronicleRunning: boolean
  chroniclePid: number | null
  chronicleRss: number
  chronicleCpuPercent: number | null
  opencodeRunning: boolean
  opencodePid: number | null
  opencodeRss: number
  opencodeCpuPercent: number | null
  opencodeUptime: number
  terminals: PtyResourceItem[]
  timestamp: number
  updatedAtLabel: string
  warnings: string[]
}

interface ResourceSnapshotInput {
  renderer: RendererMemory
  server: ServerHealth | null
  pty: PtyResources | null
  chronicle: ChronicleResources | null
  chronicleWarning: string | null
  opencode: OpencodeServerResources | null
  opencodeWarning: string | null
  timestamp: number
}

function readRendererMemory(): RendererMemory {
  if (typeof performance === 'undefined' || !('memory' in performance)) {
    return {
      heapUsed: 0,
      heapTotal: 0,
      heapLimit: 0,
    }
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

function formatTimestampLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', { hour12: false })
}

function createResourceSnapshot({
  renderer,
  server,
  pty,
  chronicle,
  chronicleWarning,
  opencode,
  opencodeWarning,
  timestamp,
}: ResourceSnapshotInput): ResourceSnapshot {
  const mbToBytes = (mb: number) => mb * 1024 * 1024
  const warnings: string[] = []

  if (!server) {
    warnings.push('Server metrics unavailable')
  }
  if (!pty) {
    warnings.push('Terminal resource metrics unavailable')
  }
  if (chronicleWarning) {
    warnings.push(chronicleWarning)
  }
  if (opencodeWarning) {
    warnings.push(opencodeWarning)
  }

  return {
    rendererHeapUsed: renderer.heapUsed,
    rendererHeapTotal: renderer.heapTotal,
    rendererHeapLimit: renderer.heapLimit,
    serverRss: server ? mbToBytes(server.memory.rss) : 0,
    serverHeapUsed: server ? mbToBytes(server.memory.heapUsed) : 0,
    serverHeapTotal: server ? mbToBytes(server.memory.heapTotal) : 0,
    serverExternal: server ? mbToBytes(server.memory.external) : 0,
    serverCpuPercent: server?.cpu?.percent ?? null,
    serverUptime: server?.uptime ?? 0,
    cliTuiRss: pty ? mbToBytes(pty.totals.cliTuiRssMB) : 0,
    cliTuiCpuPercent: pty?.totals.cliTuiCpuPercent ?? 0,
    bottomPanelRss: pty ? mbToBytes(pty.totals.bottomPanelRssMB) : 0,
    bottomPanelCpuPercent: pty?.totals.bottomPanelCpuPercent ?? 0,
    chronicleRunning: chronicle?.running ?? false,
    chroniclePid: chronicle?.pid ?? null,
    chronicleRss: chronicle?.rssMB ? mbToBytes(chronicle.rssMB) : 0,
    chronicleCpuPercent: chronicle?.cpuPercent ?? null,
    opencodeRunning: opencode?.running ?? false,
    opencodePid: opencode?.pid ?? null,
    opencodeRss: opencode?.rssMB ? mbToBytes(opencode.rssMB) : 0,
    opencodeCpuPercent: opencode?.cpuPercent ?? null,
    opencodeUptime: opencode?.uptimeSeconds ?? 0,
    terminals: pty?.terminals ?? [],
    timestamp,
    updatedAtLabel: formatTimestampLabel(timestamp),
    warnings,
  }
}

function MemoryBar({
  used,
  total,
  className,
}: {
  used: number
  total: number
  className?: string
}) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0
  return (
    <div className={className}>
      <Progress value={pct} className="h-2" />
    </div>
  )
}

function SectionRow({
  label,
  value,
  dimLabel = false,
  detail,
  branch,
}: {
  label: string
  value: string
  dimLabel?: boolean
  detail?: string
  branch?: 'middle' | 'last'
}) {
  return (
    <div className={cn('relative flex items-center gap-2 py-[3px]', branch && 'pl-6')}>
      {branch && <BranchConnector terminal={branch === 'last'} />}
      <span
        className={
          dimLabel
            ? 'text-muted-foreground flex-1 truncate text-[11px]'
            : 'flex-1 truncate text-[11px]'
        }
      >
        {label}
      </span>
      {detail && (
        <span className="max-w-24 shrink truncate text-[10px] text-muted-foreground/60">
          {detail}
        </span>
      )}
      <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{value}</span>
    </div>
  )
}

function BranchConnector({ terminal }: { terminal: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="absolute left-1 top-0 h-full w-4 text-border"
      fill="none"
      preserveAspectRatio="none"
      viewBox="0 0 16 24"
    >
      <path
        d={terminal ? 'M4 0 V12 Q4 16 8 16 H15' : 'M4 0 V24 M4 12 Q4 16 8 16 H15'}
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.25"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

function ResourceGroup({
  icon,
  label,
  value,
  children,
}: {
  icon: ReactNode
  label: string
  value: string
  children?: ReactNode
}) {
  return (
    <div className="py-1">
      <div className="flex items-center gap-2 py-[3px]">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {icon}
        </span>
        <span className="flex-1 truncate text-[11px] font-medium">{label}</span>
        <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{value}</span>
      </div>
      {children}
    </div>
  )
}

const CHRONICLE_OFF_RESOURCES: ChronicleResources = {
  running: false,
  pid: null,
  rssMB: null,
  cpuPercent: null,
}

const OPENCODE_OFF_RESOURCES: OpencodeServerResources = {
  running: false,
  pid: null,
  url: null,
  startedAt: null,
  uptimeSeconds: null,
  rssMB: null,
  cpuPercent: null,
}

function parseServerHealth(data: unknown): ServerHealth {
  return ServerHealthSchema.parse(data)
}

function parsePtyResources(data: unknown): PtyResources {
  return PtyResourcesSchema.parse(data)
}

function selectChronicleStatus(data: ChronicleStatus): ChronicleStatus {
  return { running: data.running }
}

function parseChronicleResources(data: unknown): ChronicleResources {
  return ChronicleResourcesSchema.parse(data)
}

function parseOpencodeServerResources(data: unknown): OpencodeServerResources {
  return OpencodeServerResourcesSchema.parse(data)
}

function useResourceSnapshot(open: boolean) {
  const [renderer, setRenderer] = useState(readRendererMemory)
  const [timestamp, setTimestamp] = useState(Date.now)

  const {
    data: server,
    isFetched: healthFetched,
    isFetching: healthFetching,
    isSuccess: healthSuccess,
    refetch: refetchHealth,
  } = useQuery({
    ...getHealthOptions(),
    select: parseServerHealth,
    refetchInterval: open ? REFRESH_INTERVAL_MS : SUMMARY_REFRESH_INTERVAL_MS,
  })
  const {
    data: pty,
    isFetched: ptyFetched,
    isFetching: ptyFetching,
    isSuccess: ptySuccess,
    refetch: refetchPty,
  } = useQuery({
    ...getTerminalSessionsResourcesOptions(),
    select: parsePtyResources,
    enabled: open,
    refetchInterval: REFRESH_INTERVAL_MS,
  })
  const {
    data: chronicleStatus,
    isError: chronicleStatusError,
    isFetched: chronicleStatusFetched,
    isFetching: chronicleStatusFetching,
    isSuccess: chronicleStatusSuccess,
    refetch: refetchChronicleStatus,
  } = useQuery({
    ...getChronicleStatusOptions(),
    select: selectChronicleStatus,
    enabled: open,
    refetchInterval: query =>
      open && query.state.status !== 'error' ? REFRESH_INTERVAL_MS : false,
    retry: false,
  })
  const chronicleResourcesEnabled = open && chronicleStatus?.running === true
  const {
    data: chronicleResources,
    isError: chronicleResourcesError,
    isFetched: chronicleResourcesFetched,
    isFetching: chronicleResourcesFetching,
    isSuccess: chronicleResourcesSuccess,
    refetch: refetchChronicleResources,
  } = useQuery({
    ...getChronicleDaemonResourcesOptions(),
    select: parseChronicleResources,
    enabled: chronicleResourcesEnabled,
    refetchInterval: query =>
      chronicleResourcesEnabled && query.state.status !== 'error'
        ? REFRESH_INTERVAL_MS
        : false,
    retry: false,
  })
  const opencodeResourcesEnabled = open
  const {
    data: opencodeResources,
    isError: opencodeResourcesError,
    isFetched: opencodeResourcesFetched,
    isFetching: opencodeResourcesFetching,
    isSuccess: opencodeResourcesSuccess,
    refetch: refetchOpencodeResources,
  } = useQuery({
    ...getOpencodeServerResourcesOptions(),
    select: parseOpencodeServerResources,
    enabled: opencodeResourcesEnabled,
    refetchInterval: query =>
      opencodeResourcesEnabled && query.state.status !== 'error'
        ? REFRESH_INTERVAL_MS
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
    const refetches: Array<Promise<unknown>> = [refetchHealth()]

    if (open) {
      refetches.push(refetchPty(), refetchChronicleStatus(), refetchOpencodeResources())
    }

    if (chronicleResourcesEnabled) {
      refetches.push(refetchChronicleResources())
    }

    await Promise.all(refetches)
  }

  const hasSnapshot = healthFetched
    || ptyFetched
    || chronicleStatusFetched
    || chronicleResourcesFetched
    || opencodeResourcesFetched

  const chronicleWarning = chronicleStatusError
    ? 'Chronicle status unavailable'
    : chronicleResourcesEnabled && chronicleResourcesError
      ? 'Chronicle daemon metrics unavailable'
      : null
  const chronicle = chronicleResourcesEnabled
    ? chronicleResources ?? null
    : CHRONICLE_OFF_RESOURCES
  const opencodeWarning = opencodeResourcesEnabled && opencodeResourcesError
    ? 'opencode server metrics unavailable'
    : null
  const opencode = opencodeResourcesEnabled
    ? opencodeResources ?? null
    : OPENCODE_OFF_RESOURCES
  const snap = hasSnapshot
    ? createResourceSnapshot({
        renderer,
        server: server ?? null,
        pty: pty ?? null,
        chronicle,
        chronicleWarning,
        opencode,
        opencodeWarning,
        timestamp,
      })
    : null

  const loading = healthFetching
    || ptyFetching
    || chronicleStatusFetching
    || (chronicleResourcesEnabled && chronicleResourcesFetching)
    || (opencodeResourcesEnabled && opencodeResourcesFetching)
  const resourcesReady = healthSuccess
    && ptySuccess
    && chronicleStatusSuccess
    && (!chronicleResourcesEnabled || chronicleResourcesSuccess)
    && (!opencodeResourcesEnabled || opencodeResourcesSuccess)

  return { snap, loading, refresh, resourcesReady }
}

export function ResourcesPopover() {
  const [open, setOpen] = useState(false)
  const { snap, loading, refresh, resourcesReady } = useResourceSnapshot(open)

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) {
      void refresh()
    }
  }

  const totalRendererMB = snap ? bytesToMegabytes(snap.rendererHeapUsed) : 0
  const totalServerMB = snap ? bytesToMegabytes(snap.serverRss) : 0
  const totalCliTuiMB = snap ? bytesToMegabytes(snap.cliTuiRss) : 0
  const totalBottomPanelMB = snap ? bytesToMegabytes(snap.bottomPanelRss) : 0
  const totalChronicleMB = snap ? bytesToMegabytes(snap.chronicleRss) : 0
  const totalOpencodeMB = snap ? bytesToMegabytes(snap.opencodeRss) : 0
  const totalMB = totalRendererMB + totalServerMB + totalCliTuiMB + totalBottomPanelMB + totalChronicleMB + totalOpencodeMB
  const totalCpuPercent = snap
    ? Math.round((
      (snap.serverCpuPercent ?? 0)
      + snap.cliTuiCpuPercent
      + snap.bottomPanelCpuPercent
      + (snap.chronicleCpuPercent ?? 0)
      + (snap.opencodeCpuPercent ?? 0)
    ) * 100) / 100
    : null
  const cliTuiTerminals = snap?.terminals.filter(item => item.role === 'cli-tui') ?? []
  const bottomPanelTerminals = snap?.terminals.filter(item => item.role === 'bottom-panel') ?? []

  const triggerLabel = snap ? formatResourceUsage(totalMB, totalCpuPercent) : '— MB / —'
  const footerStatusLabel = snap
    ? `Uptime ${formatUptimeSeconds(snap.serverUptime)} · Updated ${snap.updatedAtLabel}`
    : ''

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 gap-1 px-1.5 text-[11px] text-muted-foreground font-normal tabular-nums hover:text-foreground active:scale-[0.96] transition-transform"
          aria-label={`Resources: ${triggerLabel}`}
          title="Resources"
        >
          <CpuIcon aria-hidden="true" />
          {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-xl p-0 gap-0"
        data-testid="resources-popover"
        data-resources-ready={resourcesReady ? 'true' : 'false'}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <span className="text-sm font-medium">Resources</span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="Refresh resources"
            title="Refresh"
          >
            <RefreshCwIcon className={cn(loading && 'animate-spin')} aria-hidden="true" />
          </Button>
        </div>

        {/* Summary stat row */}
        <div className="grid grid-cols-2 gap-px mx-1 bg-border">
          <div className="bg-popover px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Memory
            </div>
            <div className="flex items-center gap-1.5 text-base font-semibold tabular-nums leading-none">
              <MemoryStickIcon className="size-4 !text-muted-foreground" />
              {formatMegabytes(totalMB)}
            </div>
          </div>
          <div className="bg-popover px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              CPU
            </div>
            <div className="flex items-center gap-1.5 text-base font-semibold tabular-nums leading-none">
              <CpuIcon className="size-4 !text-muted-foreground" />
              {formatCpuPercent(totalCpuPercent)}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        {snap && (
          <div className="px-3 pt-2 pb-1">
            <MemoryBar
              used={snap.rendererHeapUsed + snap.serverRss + snap.cliTuiRss + snap.bottomPanelRss + snap.chronicleRss + snap.opencodeRss}
              total={Math.max(
                snap.rendererHeapLimit,
                (snap.rendererHeapUsed + snap.serverRss + snap.cliTuiRss + snap.bottomPanelRss + snap.chronicleRss + snap.opencodeRss) * 2,
              )}
            />
          </div>
        )}

        {/* Process breakdown */}
        <div className="px-3 py-2 flex flex-row gap-2 w-full">
          {snap && snap.warnings.length > 0 && (
            <output
              data-testid="resources-warning"
              className="mb-2 flex items-start gap-2 rounded-md bg-warning/8 px-2 py-1.5 text-[11px] leading-snug text-warning"
            >
              <CircleAlertIcon className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              <span>{snap.warnings.join('. ')}</span>
            </output>
          )}

          <div className="flex-1">
            <ResourceGroup
              icon={<MonitorIcon className="size-3.5" />}
              label="Renderer"
              value={snap ? formatResourceUsage(bytesToMegabytes(snap.rendererHeapUsed), null) : '—'}
            >
              {snap && snap.rendererHeapUsed > 0 && (
                <>
                  <SectionRow
                    label="Heap Used"
                    value={formatMegabytes(bytesToMegabytes(snap.rendererHeapUsed), 1)}
                    dimLabel
                    branch="middle"
                  />
                  <SectionRow
                    label="Heap Total"
                    value={formatMegabytes(bytesToMegabytes(snap.rendererHeapTotal), 1)}
                    dimLabel
                    branch="middle"
                  />
                  <SectionRow
                    label="CPU"
                    value={formatCpuPercent(null)}
                    dimLabel
                    branch="last"
                  />
                </>
              )}
            </ResourceGroup>

            <div className="border-t border-border my-1.5" />

            <ResourceGroup
              icon={<ServerIcon className="size-3.5" />}
              label="Server"
              value={snap ? formatResourceUsage(bytesToMegabytes(snap.serverRss), snap.serverCpuPercent) : '—'}
            >
              {snap && snap.serverRss > 0 && (
                <>
                  <SectionRow
                    label="Heap Used"
                    value={formatMegabytes(bytesToMegabytes(snap.serverHeapUsed), 1)}
                    dimLabel
                    branch="middle"
                  />
                  <SectionRow
                    label="Heap Total"
                    value={formatMegabytes(bytesToMegabytes(snap.serverHeapTotal), 1)}
                    dimLabel
                    branch="middle"
                  />
                  <SectionRow
                    label="External"
                    value={formatMegabytes(bytesToMegabytes(snap.serverExternal), 1)}
                    dimLabel
                    branch="middle"
                  />
                  <SectionRow
                    label="CPU"
                    value={formatCpuPercent(snap.serverCpuPercent)}
                    dimLabel
                    branch="last"
                  />
                </>
              )}
            </ResourceGroup>
          </div>

          <div className="border-l border-border my-1.5" />

          <div className="flex-1">
            <ResourceGroup
              icon={<ActivityIcon className="size-3.5" />}
              label="Chronicle"
              value={snap?.chronicleRunning
                ? formatResourceUsage(bytesToMegabytes(snap.chronicleRss), snap.chronicleCpuPercent)
                : 'Off'}
            >
              {snap?.chronicleRunning
? (
                <SectionRow
                  label="cradle-chronicle"
                  detail={snap.chroniclePid ? `pid ${snap.chroniclePid}` : undefined}
                  value={`${snap.chronicleRss > 0 ? formatMegabytes(bytesToMegabytes(snap.chronicleRss), 1) : '—'} / ${formatCpuPercent(snap.chronicleCpuPercent)}`}
                  dimLabel
                  branch="last"
                />
              )
: (
                <SectionRow label="Not running" value="0 MB / 0%" dimLabel branch="last" />
              )}
            </ResourceGroup>

            <div className="border-t border-border my-1.5" />

            <ResourceGroup
              icon={<ServerIcon className="size-3.5" />}
              label="opencode"
              value={snap?.opencodeRunning
                ? formatResourceUsage(bytesToMegabytes(snap.opencodeRss), snap.opencodeCpuPercent)
                : 'Off'}
            >
              {snap?.opencodeRunning
                ? (
                  <SectionRow
                    label="opencode-serve"
                    detail={snap.opencodePid ? `pid ${snap.opencodePid}` : undefined}
                    value={`${snap.opencodeRss > 0 ? formatMegabytes(bytesToMegabytes(snap.opencodeRss), 1) : '—'} / ${formatCpuPercent(snap.opencodeCpuPercent)}`}
                    dimLabel
                    branch="last"
                  />
                )
                : (
                  <SectionRow label="Not running" value="0 MB / 0%" dimLabel branch="last" />
                )}
            </ResourceGroup>

            <div className="border-t border-border my-1.5" />

            <ResourceGroup
              icon={<SquareTerminalIcon className="size-3.5" />}
              label="CLI TUI"
              value={snap ? formatResourceUsage(bytesToMegabytes(snap.cliTuiRss), snap.cliTuiCpuPercent) : '—'}
            >
              {cliTuiTerminals.length > 0
? (
                cliTuiTerminals.map((item, index) => (
                  <SectionRow
                    key={item.id}
                    label={basename(item.executable)}
                    detail={`pid ${item.pid}`}
                    value={`${item.rssMB === null ? '—' : formatMegabytes(item.rssMB)} / ${formatCpuPercent(item.cpuPercent)}`}
                    dimLabel
                    branch={index === cliTuiTerminals.length - 1 ? 'last' : 'middle'}
                  />
                ))
              )
: (
                <SectionRow label="No running TUI sessions" value="0 MB / 0%" dimLabel branch="last" />
              )}
            </ResourceGroup>

            <div className="border-t border-border my-1.5" />

            <ResourceGroup
              icon={<PanelBottomIcon className="size-3.5" />}
              label="Bottom Panel"
              value={snap ? formatResourceUsage(bytesToMegabytes(snap.bottomPanelRss), snap.bottomPanelCpuPercent) : '—'}
            >
              {bottomPanelTerminals.length > 0
? (
                bottomPanelTerminals.map((item, index) => (
                  <SectionRow
                    key={item.id}
                    label={basename(item.executable)}
                    detail={`pid ${item.pid}`}
                    value={`${item.rssMB === null ? '—' : formatMegabytes(item.rssMB)} / ${formatCpuPercent(item.cpuPercent)}`}
                    dimLabel
                    branch={index === bottomPanelTerminals.length - 1 ? 'last' : 'middle'}
                  />
                ))
              )
: (
                <SectionRow label="No running panel terminals" value="0 MB / 0%" dimLabel branch="last" />
              )}
            </ResourceGroup>
          </div>
        </div>

        {snap && (
          <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground/60 tabular-nums">
            <span
              className={cn('inline-flex items-center gap-1', loading && 'text-muted-foreground')}
            >
              <RefreshCwIcon className={cn('size-3', loading && 'animate-spin')} aria-hidden="true" />
              Live
            </span>
            <span>{footerStatusLabel}</span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function basename(path: string): string {
  return path.split(PATH_SEGMENT_SEPARATOR_PATTERN).pop() || path
}
