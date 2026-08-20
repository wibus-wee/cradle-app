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
import type { ReactNode } from 'react'

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

const PATH_SEGMENT_SEPARATOR_PATTERN = /[\\/]/

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

export interface RuntimeProcessSample {
  pid: number | null
  rssMB: number | null
  cpuPercent: number | null
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
  opencodeRss: number
  opencodeCpuPercent: number | null
  opencodeUptime: number
  opencodeResources: RuntimeProcessSample[]
  kimiRunning: boolean
  kimiRss: number
  kimiCpuPercent: number | null
  kimiResources: RuntimeProcessSample[]
  codexAppServerRunning: boolean
  codexAppServerRss: number
  codexAppServerCpuPercent: number | null
  codexAppServerResources: RuntimeProcessSample[]
  relaySource: 'managed' | 'external' | 'unavailable'
  relayRunning: boolean
  relayPid: number | null
  relayRss: number
  relayCpuPercent: number | null
  terminals: PtyResourceItem[]
  timestamp: number
  updatedAtLabel: string
  warnings: string[]
}

export interface ResourcesPopoverViewProps {
  open: boolean
  snapshot: ResourceSnapshot | null
  loading: boolean
  resourcesReady: boolean
  onOpenChange: (open: boolean) => void
  onRefresh: () => void
}

function MemoryBar({ used, total }: { used: number, total: number }) {
  const percent = total > 0 ? Math.min(100, (used / total) * 100) : 0
  return <Progress value={percent} className="h-2" />
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
      <span className={cn('flex-1 truncate text-[11px]', dimLabel && 'text-muted-foreground')}>
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

function ResourceGroup({ icon, label, value, children }: {
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

function RuntimeSection({ icon, label, value, children }: {
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
      <div className="pl-5">{children}</div>
    </div>
  )
}

function RuntimeProvider({
  label,
  value,
  running,
  pid,
  processLabel,
  rssMB,
  cpuPercent,
  processes,
  isLast,
  inactiveLabel = 'Not running',
}: {
  label: string
  value: string
  running: boolean
  pid?: number | null
  processLabel?: string
  rssMB?: number | null
  cpuPercent?: number | null
  processes?: RuntimeProcessSample[]
  isLast?: boolean
  inactiveLabel?: string
}) {
  const processRows = processes ?? (running
    ? [{ pid: pid ?? null, rssMB: rssMB ?? null, cpuPercent: cpuPercent ?? null }]
    : [])

  return (
    <div className="relative">
      <SectionRow label={label} value={value} />
      {processRows.length > 0 && processLabel
        ? processRows.map((process, index) => (
            <SectionRow
              key={`${processLabel}-${process.pid ?? index}`}
              label={processLabel}
              detail={process.pid ? `pid ${process.pid}` : undefined}
              value={`${process.rssMB && process.rssMB > 0 ? formatMegabytes(process.rssMB, 1) : '—'} / ${formatCpuPercent(process.cpuPercent ?? null)}`}
              dimLabel
              branch={isLast && index === processRows.length - 1 ? 'last' : 'middle'}
            />
          ))
        : (
            <SectionRow
              label={inactiveLabel}
              value="0 MB / 0%"
              dimLabel
              branch={isLast ? 'last' : 'middle'}
            />
          )}
    </div>
  )
}

export function ResourcesPopoverView({
  open,
  snapshot,
  loading,
  resourcesReady,
  onOpenChange,
  onRefresh,
}: ResourcesPopoverViewProps) {
  const totalRendererMB = snapshot ? bytesToMegabytes(snapshot.rendererHeapUsed) : 0
  const totalServerMB = snapshot ? bytesToMegabytes(snapshot.serverRss) : 0
  const totalCliTuiMB = snapshot ? bytesToMegabytes(snapshot.cliTuiRss) : 0
  const totalBottomPanelMB = snapshot ? bytesToMegabytes(snapshot.bottomPanelRss) : 0
  const totalChronicleMB = snapshot ? bytesToMegabytes(snapshot.chronicleRss) : 0
  const totalOpencodeMB = snapshot ? bytesToMegabytes(snapshot.opencodeRss) : 0
  const totalKimiMB = snapshot ? bytesToMegabytes(snapshot.kimiRss) : 0
  const totalCodexAppServerMB = snapshot ? bytesToMegabytes(snapshot.codexAppServerRss) : 0
  const totalRelayMB = snapshot ? bytesToMegabytes(snapshot.relayRss) : 0
  const totalRuntimeMB = totalOpencodeMB
    + totalKimiMB
    + totalCodexAppServerMB
    + totalChronicleMB
    + totalRelayMB
  const totalRuntimeCpuPercent = snapshot
    ? Math.round((
        (snapshot.opencodeCpuPercent ?? 0)
        + (snapshot.kimiCpuPercent ?? 0)
        + (snapshot.codexAppServerCpuPercent ?? 0)
        + (snapshot.chronicleCpuPercent ?? 0)
        + (snapshot.relayCpuPercent ?? 0)
      ) * 100) / 100
    : null
  const totalMB = totalRendererMB + totalServerMB + totalCliTuiMB + totalBottomPanelMB + totalRuntimeMB
  const totalCpuPercent = snapshot
    ? Math.round((
        (snapshot.serverCpuPercent ?? 0)
        + snapshot.cliTuiCpuPercent
        + snapshot.bottomPanelCpuPercent
        + (snapshot.chronicleCpuPercent ?? 0)
        + (snapshot.opencodeCpuPercent ?? 0)
        + (snapshot.kimiCpuPercent ?? 0)
        + (snapshot.codexAppServerCpuPercent ?? 0)
        + (snapshot.relayCpuPercent ?? 0)
      ) * 100) / 100
    : null
  const cliTuiTerminals = snapshot?.terminals.filter(item => item.role === 'cli-tui') ?? []
  const bottomPanelTerminals = snapshot?.terminals.filter(item => item.role === 'bottom-panel') ?? []
  const triggerLabel = snapshot ? formatResourceUsage(totalMB, totalCpuPercent) : '— MB / —'
  const footerStatusLabel = snapshot
    ? `Uptime ${formatUptimeSeconds(snapshot.serverUptime)} · Updated ${snapshot.updatedAtLabel}`
    : ''

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 gap-1 px-1.5 text-[11px] font-normal tabular-nums text-muted-foreground transition-transform hover:text-foreground active:scale-[0.96]"
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
        className="w-xl gap-0 p-0"
        data-testid="resources-popover"
        data-resources-ready={resourcesReady ? 'true' : 'false'}
      >
        <div className="flex items-center justify-between px-3 pb-2 pt-3">
          <span className="text-sm font-medium">Resources</span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh resources"
            title="Refresh"
          >
            <RefreshCwIcon className={cn(loading && 'animate-spin')} aria-hidden="true" />
          </Button>
        </div>

        <div className="mx-1 grid grid-cols-2 gap-px bg-border">
          <div className="bg-popover px-3 py-2.5">
            <div className="mb-1 text-[10px] text-muted-foreground">Memory</div>
            <div className="flex items-center gap-1.5 text-base font-semibold leading-none tabular-nums">
              <MemoryStickIcon className="size-4 !text-muted-foreground" />
              {formatMegabytes(totalMB)}
            </div>
          </div>
          <div className="bg-popover px-3 py-2.5">
            <div className="mb-1 text-[10px] text-muted-foreground">CPU</div>
            <div className="flex items-center gap-1.5 text-base font-semibold leading-none tabular-nums">
              <CpuIcon className="size-4 !text-muted-foreground" />
              {formatCpuPercent(totalCpuPercent)}
            </div>
          </div>
        </div>

        {snapshot && (
          <div className="px-3 pb-1 pt-2">
            <MemoryBar
              used={snapshot.rendererHeapUsed
                + snapshot.serverRss
                + snapshot.cliTuiRss
                + snapshot.bottomPanelRss
                + snapshot.chronicleRss
                + snapshot.opencodeRss
                + snapshot.kimiRss
                + snapshot.codexAppServerRss
                + snapshot.relayRss}
              total={Math.max(
                snapshot.rendererHeapLimit,
                (snapshot.rendererHeapUsed
                  + snapshot.serverRss
                  + snapshot.cliTuiRss
                  + snapshot.bottomPanelRss
                  + snapshot.chronicleRss
                  + snapshot.opencodeRss
                  + snapshot.kimiRss
                  + snapshot.codexAppServerRss
                  + snapshot.relayRss) * 2,
              )}
            />
          </div>
        )}

        <div className="flex w-full flex-row gap-2 px-3 py-2">
          {snapshot && snapshot.warnings.length > 0 && (
            <output
              data-testid="resources-warning"
              className="mb-2 flex items-start gap-2 rounded-md bg-warning/8 px-2 py-1.5 text-[11px] leading-snug text-warning"
            >
              <CircleAlertIcon className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              <span>{snapshot.warnings.join('. ')}</span>
            </output>
          )}

          <div className="flex-1">
            <ResourceGroup
              icon={<MonitorIcon className="size-3.5" />}
              label="Renderer"
              value={snapshot ? formatResourceUsage(bytesToMegabytes(snapshot.rendererHeapUsed), null) : '—'}
            >
              {snapshot && snapshot.rendererHeapUsed > 0 && (
                <>
                  <SectionRow label="Heap Used" value={formatMegabytes(bytesToMegabytes(snapshot.rendererHeapUsed), 1)} dimLabel branch="middle" />
                  <SectionRow label="Heap Total" value={formatMegabytes(bytesToMegabytes(snapshot.rendererHeapTotal), 1)} dimLabel branch="middle" />
                  <SectionRow label="CPU" value={formatCpuPercent(null)} dimLabel branch="last" />
                </>
              )}
            </ResourceGroup>

            <div className="my-1.5 border-t border-border" />

            <ResourceGroup
              icon={<ServerIcon className="size-3.5" />}
              label="Server"
              value={snapshot ? formatResourceUsage(bytesToMegabytes(snapshot.serverRss), snapshot.serverCpuPercent) : '—'}
            >
              {snapshot && snapshot.serverRss > 0 && (
                <>
                  <SectionRow label="Heap Used" value={formatMegabytes(bytesToMegabytes(snapshot.serverHeapUsed), 1)} dimLabel branch="middle" />
                  <SectionRow label="Heap Total" value={formatMegabytes(bytesToMegabytes(snapshot.serverHeapTotal), 1)} dimLabel branch="middle" />
                  <SectionRow label="External" value={formatMegabytes(bytesToMegabytes(snapshot.serverExternal), 1)} dimLabel branch="middle" />
                  <SectionRow label="CPU" value={formatCpuPercent(snapshot.serverCpuPercent)} dimLabel branch="last" />
                </>
              )}
            </ResourceGroup>
          </div>

          <div className="my-1.5 border-l border-border" />

          <div className="flex-1">
            <RuntimeSection
              icon={<ActivityIcon className="size-3.5" />}
              label="Runtime"
              value={snapshot ? formatResourceUsage(totalRuntimeMB, totalRuntimeCpuPercent) : '—'}
            >
              <RuntimeProvider
                label="Relay"
                value={snapshot?.relaySource === 'external'
                  ? 'External'
                  : snapshot?.relayRunning
                    ? formatResourceUsage(bytesToMegabytes(snapshot.relayRss), snapshot.relayCpuPercent)
                    : 'Off'}
                running={snapshot?.relayRunning ?? false}
                pid={snapshot?.relayPid}
                processLabel="relayd"
                rssMB={snapshot?.relayRss ? bytesToMegabytes(snapshot.relayRss) : null}
                cpuPercent={snapshot?.relayCpuPercent}
                inactiveLabel={snapshot?.relaySource === 'external' ? 'External Relay' : 'Not running'}
              />
              <RuntimeProvider
                label="opencode"
                value={snapshot?.opencodeRunning ? formatResourceUsage(bytesToMegabytes(snapshot.opencodeRss), snapshot.opencodeCpuPercent) : 'Off'}
                running={snapshot?.opencodeRunning ?? false}
                processLabel="opencode-serve"
                processes={snapshot?.opencodeResources}
              />
              <RuntimeProvider
                label="kimi"
                value={snapshot?.kimiRunning ? formatResourceUsage(bytesToMegabytes(snapshot.kimiRss), snapshot.kimiCpuPercent) : 'Off'}
                running={snapshot?.kimiRunning ?? false}
                processLabel="kimi-server"
                processes={snapshot?.kimiResources}
              />
              <RuntimeProvider
                label="codex-app-server"
                value={snapshot?.codexAppServerRunning ? formatResourceUsage(bytesToMegabytes(snapshot.codexAppServerRss), snapshot.codexAppServerCpuPercent) : 'Off'}
                running={snapshot?.codexAppServerRunning ?? false}
                processLabel="codex-app-server"
                processes={snapshot?.codexAppServerResources}
              />
              <RuntimeProvider
                label="Chronicle"
                value={snapshot?.chronicleRunning ? formatResourceUsage(bytesToMegabytes(snapshot.chronicleRss), snapshot.chronicleCpuPercent) : 'Off'}
                running={snapshot?.chronicleRunning ?? false}
                pid={snapshot?.chroniclePid}
                processLabel="cradle-chronicle"
                rssMB={snapshot?.chronicleRss ? bytesToMegabytes(snapshot.chronicleRss) : null}
                cpuPercent={snapshot?.chronicleCpuPercent}
                isLast
              />
            </RuntimeSection>

            <div className="my-1.5 border-t border-border" />

            <ResourceGroup
              icon={<SquareTerminalIcon className="size-3.5" />}
              label="CLI TUI"
              value={snapshot ? formatResourceUsage(bytesToMegabytes(snapshot.cliTuiRss), snapshot.cliTuiCpuPercent) : '—'}
            >
              {cliTuiTerminals.length > 0
                ? cliTuiTerminals.map((item, index) => (
                    <SectionRow
                      key={item.id}
                      label={basename(item.executable)}
                      detail={`pid ${item.pid}`}
                      value={`${item.rssMB === null ? '—' : formatMegabytes(item.rssMB)} / ${formatCpuPercent(item.cpuPercent)}`}
                      dimLabel
                      branch={index === cliTuiTerminals.length - 1 ? 'last' : 'middle'}
                    />
                  ))
                : <SectionRow label="No running TUI sessions" value="0 MB / 0%" dimLabel branch="last" />}
            </ResourceGroup>

            <div className="my-1.5 border-t border-border" />

            <ResourceGroup
              icon={<PanelBottomIcon className="size-3.5" />}
              label="Bottom Panel"
              value={snapshot ? formatResourceUsage(bytesToMegabytes(snapshot.bottomPanelRss), snapshot.bottomPanelCpuPercent) : '—'}
            >
              {bottomPanelTerminals.length > 0
                ? bottomPanelTerminals.map((item, index) => (
                    <SectionRow
                      key={item.id}
                      label={basename(item.executable)}
                      detail={`pid ${item.pid}`}
                      value={`${item.rssMB === null ? '—' : formatMegabytes(item.rssMB)} / ${formatCpuPercent(item.cpuPercent)}`}
                      dimLabel
                      branch={index === bottomPanelTerminals.length - 1 ? 'last' : 'middle'}
                    />
                  ))
                : <SectionRow label="No running panel terminals" value="0 MB / 0%" dimLabel branch="last" />}
            </ResourceGroup>
          </div>
        </div>

        {snapshot && (
          <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[10px] tabular-nums text-muted-foreground/60">
            <span className={cn('inline-flex items-center gap-1', loading && 'text-muted-foreground')}>
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
