// Web plugin entry - runs in browser context
// Uses React via import map resolution (provided by host in dev + prod)
import type { WebPluginContext } from '@cradle/plugin-sdk/web'
import {
  AlertLine as AlertCircleIcon,
  ChipLine as CpuIcon,
  Dashboard2Line as GaugeIcon,
  DriveLine as HardDriveIcon,
  HeartbeatLine as ActivityIcon,
  MonitorLine as MonitorIcon,
  Refresh1Line as RefreshCwIcon,
  ServerLine as ServerIcon,
  TerminalLine as TerminalIcon,
  UsbFlashDiskLine as MemoryStickIcon,
} from '@mingcute/react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty'
import { Progress } from '~/components/ui/progress'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Separator } from '~/components/ui/separator'
import { Skeleton } from '~/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'
import { formatGigabytes, formatUptimeSeconds } from '~/lib/number-format'

interface SystemInfo {
  hostname: string
  platform: string
  arch: string
  cpuModel: string
  cpuCores: number
  totalMemoryGB: number
  freeMemoryGB: number
  usedMemoryGB: number
  memoryUsagePercent: number
  uptimeHours: number
  nodeVersion: string
}

interface MetricCard {
  label: string
  value: string
  detail: string
  icon: typeof MemoryStickIcon
}

interface DetailRow {
  label: string
  value: string
  icon: typeof ServerIcon
}

function LoadingPanel() {
  return (
    <div className="flex h-full min-h-72 flex-col gap-3 p-3">
      <Card size="sm" className="shrink-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Skeleton className="size-8 rounded-lg" />
            <Skeleton className="h-4 w-28" />
          </CardTitle>
          <CardDescription>
            <Skeleton className="h-3 w-40" />
          </CardDescription>
        </CardHeader>
      </Card>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
      <Skeleton className="h-44 rounded-xl" />
    </div>
  )
}

function EmptyPanel({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="flex h-full min-h-72 p-3">
      <Empty className="border border-border bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MonitorIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No system snapshot</EmptyTitle>
          <EmptyDescription>
            Open the panel or refresh to read the latest host runtime information.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button type="button" size="sm" onClick={onRefresh}>
            <RefreshCwIcon aria-hidden="true" />
            Refresh
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}

function ErrorPanel({ error, onRefresh }: { error: string, onRefresh: () => void }) {
  return (
    <div className="flex h-full min-h-72 flex-col gap-3 p-3">
      <Alert variant="destructive">
        <AlertCircleIcon aria-hidden="true" />
        <AlertTitle>System info unavailable</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
      <Button type="button" size="sm" variant="outline" className="self-start" onClick={onRefresh}>
        <RefreshCwIcon aria-hidden="true" />
        Retry
      </Button>
    </div>
  )
}

function MetricCardItem({ metric }: { metric: MetricCard }) {
  const Icon = metric.icon

  return (
    <Card size="sm" className="min-w-0">
      <CardHeader className="gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <CardDescription className="text-xs">{metric.label}</CardDescription>
              <CardTitle className="truncate font-mono text-sm tabular-nums">{metric.value}</CardTitle>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="truncate text-xs text-muted-foreground">{metric.detail}</p>
      </CardContent>
    </Card>
  )
}

function DetailList({ rows }: { rows: DetailRow[] }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Runtime details</CardTitle>
        <CardDescription>Host and process metadata exposed by the plugin route.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-0">
        {rows.map((row, index) => {
          const Icon = row.icon
          return (
            <div key={row.label}>
              {index > 0 && <Separator />}
              <div className="flex min-w-0 items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="text-xs text-muted-foreground">{row.label}</span>
                </div>
                <Tooltip>
                  <TooltipTrigger>
                    <span className="block max-w-40 truncate text-right font-mono text-xs tabular-nums text-foreground">
                      {row.value}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{row.value}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function SystemInfoPanel({ isActive, routes }: { isActive: boolean, routes: WebPluginContext['routes'] }) {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchInfo = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await routes.fetch('/info')
      if (!res.ok) {
        setError(`HTTP ${res.status}`)
        setLoading(false)
        return
      }
      setInfo(await res.json())
      setLoading(false)
    }
 catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }, [routes])

  useEffect(() => {
    if (!isActive) { return }
    queueMicrotask(() => void fetchInfo())
  }, [fetchInfo, isActive])

  const metrics = useMemo<MetricCard[]>(() => {
    if (!info) { return [] }
    return [
      {
        label: 'Memory used',
        value: formatGigabytes(info.usedMemoryGB),
        detail: `${formatGigabytes(info.freeMemoryGB)} free of ${formatGigabytes(info.totalMemoryGB)}`,
        icon: MemoryStickIcon,
      },
      {
        label: 'CPU cores',
        value: String(info.cpuCores),
        detail: info.cpuModel,
        icon: CpuIcon,
      },
    ]
  }, [info])

  const details = useMemo<DetailRow[]>(() => {
    if (!info) { return [] }
    return [
      { label: 'Hostname', value: info.hostname, icon: ServerIcon },
      { label: 'Platform', value: `${info.platform} (${info.arch})`, icon: MonitorIcon },
      { label: 'Uptime', value: formatUptimeSeconds(info.uptimeHours * 3600), icon: ActivityIcon },
      { label: 'Node.js', value: info.nodeVersion, icon: TerminalIcon },
    ]
  }, [info])

  if (loading && !info) {
    return (
      <TooltipProvider>
        <LoadingPanel />
      </TooltipProvider>
    )
  }
  if (error) {
    return (
      <TooltipProvider>
        <ErrorPanel error={error} onRefresh={fetchInfo} />
      </TooltipProvider>
    )
  }
  if (!info) {
    return (
      <TooltipProvider>
        <EmptyPanel onRefresh={fetchInfo} />
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider>
      <ScrollArea className="h-full" viewportClassName="max-h-full" contentClassName="min-w-0 p-3">
        <div className="flex min-w-0 flex-col gap-3">
          <Card size="sm" className="shrink-0">
            <CardHeader>
              <CardTitle className="flex min-w-0 items-center gap-2 text-balance">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <HardDriveIcon className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 truncate">System Info</span>
              </CardTitle>
              <CardDescription className="text-pretty">
                Live host snapshot from the plugin-scoped API route.
              </CardDescription>
              <CardAction>
                <Tooltip>
                  <TooltipTrigger
                    render={(
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        onClick={() => void fetchInfo()}
                        disabled={loading}
                        aria-label="Refresh system info"
                      >
                        <RefreshCwIcon
                          className={loading ? 'size-3.5 animate-spin' : 'size-3.5'}
                          aria-hidden="true"
                        />
                      </Button>
                    )}
                  />
                  <TooltipContent>Refresh system info</TooltipContent>
                </Tooltip>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  <GaugeIcon aria-hidden="true" />
                  {info.memoryUsagePercent}
                  % memory
                </Badge>
                <Badge variant="outline">{info.platform}</Badge>
                <Badge variant="outline">{info.arch}</Badge>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-muted-foreground">Memory pressure</span>
                  <span className="font-mono tabular-nums text-foreground">
{info.memoryUsagePercent}
%
                  </span>
                </div>
                <Progress value={info.memoryUsagePercent} className="h-1.5" />
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {metrics.map(metric => (
              <MetricCardItem key={metric.label} metric={metric} />
            ))}
          </div>

          <DetailList rows={details} />
        </div>
      </ScrollArea>
    </TooltipProvider>
  )
}

export function activate(ctx: WebPluginContext): void {
  ctx.panels.register({
    id: 'system-info',
    title: 'System Info',
    component: props => <SystemInfoPanel {...props} routes={ctx.routes} />,
    location: 'sidebar',
  })

  ctx.commands.register({
    id: 'show',
    title: 'Show System Info',
    async execute() {
      try {
        const response = await ctx.routes.fetch('/info')
        if (!response.ok) {
          ctx.logger.info('Failed to fetch system info:', response.status.toString())
          return
        }
        const data = await response.json()
        ctx.logger.info('System Info:', data)
        ctx.storage.set('lastCheck', new Date().toISOString())
      }
 catch (err) {
        ctx.logger.info('Error fetching system info:', String(err))
      }
    },
  })

  ctx.logger.info('System Info plugin (web) activated')
}
