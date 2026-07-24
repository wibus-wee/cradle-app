import {
  ExternalLinkLine as ExternalLinkIcon,
  Refresh1Line as RefreshIcon,
  ServerLine as ServerIcon,
} from '@mingcute/react'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

import type { BrowserLocalServer } from './use-local-servers'

export interface BrowserNewTabSurfaceViewProps {
  localServers: BrowserLocalServer[]
  localServersLoading: boolean
  localServersError: string | null
  onOpenUrl: (url: string) => void
  onRefreshLocalServers: () => void
}

function localServerStatusLabel(statusCode: number | null): string {
  if (statusCode === null) {
    return 'HTTP'
  }
  if (statusCode >= 200 && statusCode < 300) {
    return 'Ready'
  }
  if (statusCode >= 300 && statusCode < 400) {
    return `${statusCode} redirect`
  }
  return `${statusCode}`
}

export function BrowserNewTabSurfaceView({
  localServers,
  localServersLoading,
  localServersError,
  onOpenUrl,
  onRefreshLocalServers,
}: BrowserNewTabSurfaceViewProps) {
  const localServerCountLabel = localServersLoading
    ? 'Scanning'
    : `${localServers.length} local ${localServers.length === 1 ? 'server' : 'servers'}`

  return (
    <div className="absolute inset-0 overflow-auto bg-background text-foreground">
      <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col px-5 py-10">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium text-foreground">
              New tab
            </h2>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {localServerCountLabel}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
            onClick={onRefreshLocalServers}
            disabled={localServersLoading}
            aria-label="Refresh local servers"
          >
            <RefreshIcon
              className={cn(
                'size-3.5',
                localServersLoading && 'animate-spin',
              )}
            />
          </Button>
        </div>

        <div className="grid overflow-hidden rounded-lg border border-border/60 bg-muted/20">
          {localServers.map(server => (
            <Button
              key={server.url}
              type="button"
              variant="ghost"
              className="group h-auto min-h-14 w-full min-w-0 justify-start gap-3 rounded-none border-b border-border/50 px-3 py-2 text-left font-normal whitespace-normal last:border-b-0 hover:bg-muted/50"
              onClick={() => onOpenUrl(server.url)}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground ring-1 ring-border/60">
                <ServerIcon className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-foreground">
                  {server.title}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  {`localhost:${server.port}`}
                </span>
              </span>
              <span className="shrink-0 rounded-md bg-background px-2 py-1 text-[10px] font-medium tabular-nums text-muted-foreground ring-1 ring-border/60">
                {localServerStatusLabel(server.statusCode)}
              </span>
              <ExternalLinkIcon className="size-3.5 shrink-0 !text-muted-foreground transition-colors group-hover:!text-foreground" />
            </Button>
          ))}
        </div>

        {!localServersLoading && localServers.length === 0
          ? (
              <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 py-8 text-center text-xs text-muted-foreground">
                {localServersError ?? 'No local servers found.'}
              </div>
            )
          : null}

        {localServersLoading && localServers.length === 0
          ? (
              <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-8 text-center text-xs text-muted-foreground">
                Scanning localhost.
              </div>
            )
          : null}
      </div>
    </div>
  )
}
