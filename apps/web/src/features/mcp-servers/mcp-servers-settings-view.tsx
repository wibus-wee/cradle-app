import {
  AddLine as AddIcon,
  AlertLine as AlertIcon,
  ChipLine as ChipIcon,
  CompassLine as CompassIcon,
  DeleteLine as DeleteIcon,
  EarthLine as GlobeIcon,
  EditLine as EditIcon,
  LockLine as LockIcon,
  Refresh2Line as RefreshIcon,
  ServerLine as ServerIcon,
  TerminalBoxLine as TerminalIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { GetMcpServersResponse } from '~/api-gen/types.gen'
import { Button } from '~/components/ui/button'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { SettingsGroup, SettingsPage } from '~/features/settings/settings-container'
import { cn } from '~/lib/cn'

import { cardDotTexture } from './card-textures'
import { DitheredGlyph } from './dithered-glyph'

export type McpSettingsServer = GetMcpServersResponse[number]
export type McpServersSettingsMode = 'installed' | 'discover'

export interface McpServersSettingsViewProps {
  mode: McpServersSettingsMode
  servers: McpSettingsServer[]
  isLoading: boolean
  isError: boolean
  toggling: boolean
  discover: ReactNode
  onModeChange: (mode: McpServersSettingsMode) => void
  onRetry: () => void
  onAdd: () => void
  onToggle: (server: McpSettingsServer, enabled: boolean) => void
  onEdit: (server: McpSettingsServer) => void
  onDelete: (server: McpSettingsServer) => void
}

const statusTextClasses: Record<McpSettingsServer['status'], string> = {
  ready: 'text-emerald-600 dark:text-emerald-500',
  disabled: 'text-muted-foreground/70',
  error: 'text-destructive',
}

const RUNTIME_CAPTION_LIMIT = 2

function runtimeCaption(runtimes: string[]): string {
  const shown = runtimes.slice(0, RUNTIME_CAPTION_LIMIT).join(', ')
  const rest = runtimes.length - RUNTIME_CAPTION_LIMIT
  return rest > 0 ? `${shown} +${rest}` : shown
}

function ServerCard({ server, toggling, onToggle, onEdit, onDelete }: {
  server: McpSettingsServer
  toggling: boolean
  onToggle: (server: McpSettingsServer, enabled: boolean) => void
  onEdit: (server: McpSettingsServer) => void
  onDelete: (server: McpSettingsServer) => void
}) {
  const { t } = useTranslation('settings')
  const TransportGlyph = server.transport === 'stdio' ? TerminalIcon : GlobeIcon
  return (
    <div className="group relative min-w-0 overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-foreground/20">
      <div className={cardDotTexture} aria-hidden="true" />
      <DitheredGlyph icon={TransportGlyph} className="-bottom-6 -right-5 size-24 rotate-12 opacity-[0.15]" />

      <div className="relative flex items-center gap-2.5 px-3.5 pt-3.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
              <TransportGlyph className="size-4" />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {server.transport === 'stdio' ? t('mcpServers.transport.stdio') : t('mcpServers.transport.http')}
          </TooltipContent>
        </Tooltip>
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="truncate text-[13px] font-medium text-foreground">{server.name}</span>
          <span className={cn('shrink-0 text-[10px] font-medium', statusTextClasses[server.status])}>
            {t(`mcpServers.status.${server.status}`)}
          </span>
        </div>
        <Switch
          size="sm"
          checked={server.enabled}
          onCheckedChange={enabled => onToggle(server, enabled)}
          disabled={toggling}
          aria-label={t('mcpServers.action.toggle', { name: server.name })}
        />
      </div>

      <p className="relative mx-3.5 mt-2.5 truncate rounded-md border border-border/60 bg-muted/50 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
        {server.transport === 'stdio' && <span className="mr-1.5 select-none text-muted-foreground/50">$</span>}
        {server.transport === 'stdio'
          ? [server.command, ...(server.args ?? [])].join(' ')
          : server.url}
      </p>
      <div className="relative mt-2 flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 px-3.5">
        {server.secretKeys.length > 0 && (
          <span className="inline-flex min-w-0 items-center gap-1 font-mono text-[10px] leading-4 text-muted-foreground">
            <LockIcon className="size-2.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{server.secretKeys.join(', ')}</span>
          </span>
        )}
        {server.status === 'error' && server.error && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex min-w-0 items-center gap-1 text-[10px] font-medium leading-4 text-destructive">
                <AlertIcon className="size-2.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{server.error}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">{server.error}</TooltipContent>
          </Tooltip>
        )}
      </div>

      <div className="relative mt-2.5 flex items-center justify-between gap-2 border-t border-dashed border-border px-3.5 py-2.5">
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <ChipIcon className="size-3 shrink-0 opacity-60" aria-hidden="true" />
          <span className="truncate font-mono text-[10px]">
            {server.supportedRuntimes.length > 0 ? runtimeCaption(server.supportedRuntimes) : null}
          </span>
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost" onClick={() => onEdit(server)} aria-label={t('mcpServers.action.edit')}>
                <EditIcon className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('mcpServers.action.edit')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost" onClick={() => onDelete(server)} aria-label={t('mcpServers.action.delete')}>
                <DeleteIcon className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('mcpServers.action.delete')}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

export function McpServersSettingsView({
  mode,
  servers,
  isLoading,
  isError,
  toggling,
  discover,
  onModeChange,
  onRetry,
  onAdd,
  onToggle,
  onEdit,
  onDelete,
}: McpServersSettingsViewProps) {
  const { t } = useTranslation('settings')
  return (
    <SettingsPage
      title={t('mcpServers.page.title')}
      description={t('mcpServers.page.description')}
      maxWidth="3xl"
      action={(
        <Button size="sm" onClick={onAdd}>
          <AddIcon />
          {t('mcpServers.action.add')}
        </Button>
      )}
    >
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={mode}
        onValueChange={(value) => {
          if (value === 'installed' || value === 'discover') { onModeChange(value) }
        }}
        className="self-start"
      >
        <ToggleGroupItem value="installed" className="gap-1.5 px-3">
          <ServerIcon className="size-3.5" />
          {t('mcpServers.tabs.installed')}
        </ToggleGroupItem>
        <ToggleGroupItem value="discover" className="gap-1.5 px-3">
          <CompassIcon className="size-3.5" />
          {t('mcpServers.tabs.discover')}
        </ToggleGroupItem>
      </ToggleGroup>

      {mode === 'discover'
        ? discover
        : isLoading
          ? (
              <SettingsGroup bare>
                <div className="flex min-h-40 items-center justify-center">
                  <Spinner />
                </div>
              </SettingsGroup>
            )
          : isError
            ? (
                <SettingsGroup bare>
                  <Empty className="min-h-48 border-none">
                    <EmptyMedia variant="icon"><ServerIcon /></EmptyMedia>
                    <EmptyTitle>{t('mcpServers.error.title')}</EmptyTitle>
                    <EmptyDescription>{t('mcpServers.error.description')}</EmptyDescription>
                    <Button size="sm" variant="outline" onClick={onRetry}>
                      <RefreshIcon />
                      {t('mcpServers.action.retry')}
                    </Button>
                  </Empty>
                </SettingsGroup>
              )
            : servers.length === 0
              ? (
                  <div className="relative flex flex-col items-center gap-4 overflow-hidden rounded-xl border border-dashed border-foreground/10 bg-muted/20 px-6 py-12 text-center">
                    <div className={cardDotTexture} aria-hidden="true" />
                    <div className="relative flex size-11 items-center justify-center rounded-2xl bg-foreground/5 text-foreground/70">
                      <ServerIcon className="size-5" aria-hidden="true" />
                    </div>
                    <div className="max-w-md space-y-1.5">
                      <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">{t('mcpServers.empty.title')}</h2>
                      <p className="text-[12.5px] leading-relaxed text-muted-foreground">{t('mcpServers.empty.description')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => onModeChange('discover')}>
                        <CompassIcon />
                        {t('mcpServers.action.browseRegistry')}
                      </Button>
                      <Button size="sm" onClick={onAdd}>
                        <AddIcon />
                        {t('mcpServers.action.add')}
                      </Button>
                    </div>
                  </div>
                )
              : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {servers.map(server => (
                      <ServerCard
                        key={server.id}
                        server={server}
                        toggling={toggling}
                        onToggle={onToggle}
                        onEdit={onEdit}
                        onDelete={onDelete}
                      />
                    ))}
                  </div>
                )}
    </SettingsPage>
  )
}
