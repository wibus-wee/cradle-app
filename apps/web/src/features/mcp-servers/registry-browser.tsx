import {
  EarthLine as GlobeIcon,
  LockLine as LockIcon,
  Refresh2Line as RefreshIcon,
  SearchLine as SearchIcon,
  TerminalBoxLine as TerminalIcon,
} from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import type { GetMcpServersRegistryServersResponse } from '~/api-gen/types.gen'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'

import { DitheredGlyph } from './dithered-glyph'

export type RegistryCandidate = GetMcpServersRegistryServersResponse['servers'][number]

export interface RegistryBrowserViewProps {
  search: string
  candidates: RegistryCandidate[]
  isLoading: boolean
  isError: boolean
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onSearchChange: (search: string) => void
  onRetry: () => void
  onLoadMore: () => void
  onInstall: (candidate: RegistryCandidate) => void
}

function CandidateCard({ candidate, onInstall }: {
  candidate: RegistryCandidate
  onInstall: (candidate: RegistryCandidate) => void
}) {
  const { t } = useTranslation('settings')
  const installable = candidate.installHint !== null
  const TransportGlyph = candidate.installHint?.transport === 'streamable-http' ? GlobeIcon : TerminalIcon
  const requiredEnvCount = candidate.env.filter(variable => variable.required).length
  const installSummary = candidate.installHint === null
    ? null
    : candidate.installHint.transport === 'stdio'
      ? [candidate.installHint.command, ...candidate.installHint.args].join(' ')
      : candidate.installHint.url
  return (
    <div className="relative min-w-0 overflow-hidden rounded-lg border border-border bg-card p-3 transition-colors hover:border-foreground/20">
      <DitheredGlyph icon={TransportGlyph} className="-right-2 -top-2 size-16 rotate-12 opacity-[0.12]" />
      <div className="relative flex items-center gap-2.5">
        {installSummary
          ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground">
                    <TransportGlyph className="size-4" />
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-72 font-mono text-[11px]">{installSummary}</TooltipContent>
              </Tooltip>
            )
          : (
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground">
                <TransportGlyph className="size-4" />
              </div>
            )}
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="truncate text-[13px] font-medium text-foreground">{candidate.title ?? candidate.name}</span>
          {candidate.version && (
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {`v${candidate.version}`}
            </span>
          )}
        </div>
      </div>

      <p className="relative mt-2 line-clamp-2 min-h-8 text-xs leading-relaxed text-muted-foreground">
        {candidate.description}
      </p>

      <div className="relative mt-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] leading-4 text-muted-foreground/80">
          {candidate.packageRegistry && <span>{candidate.packageRegistry}</span>}
          {candidate.packageRegistry && requiredEnvCount > 0 && <span aria-hidden="true">·</span>}
          {requiredEnvCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <LockIcon className="size-2.5" aria-hidden="true" />
              {requiredEnvCount}
            </span>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => onInstall(candidate)}>
          {installable
            ? t('mcpServers.registry.install')
            : t('mcpServers.registry.notInstallable')}
        </Button>
      </div>
    </div>
  )
}

export function RegistryBrowserView({
  search,
  candidates,
  isLoading,
  isError,
  hasNextPage,
  isFetchingNextPage,
  onSearchChange,
  onRetry,
  onLoadMore,
  onInstall,
}: RegistryBrowserViewProps) {
  const { t } = useTranslation('settings')
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="space-y-1">
        <h2 className="text-[13px] font-medium text-foreground">{t('mcpServers.registry.title')}</h2>
        <p className="text-xs text-muted-foreground">{t('mcpServers.registry.description')}</p>
      </div>

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={event => onSearchChange(event.target.value)}
          placeholder={t('mcpServers.registry.searchPlaceholder')}
          className="pl-8"
          autoComplete="off"
        />
      </div>

      {isLoading
        ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
              <Spinner />
              {t('mcpServers.registry.loading')}
            </div>
          )
        : isError
          ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-foreground/10 bg-muted/20 px-6 py-10 text-center">
                <p className="text-[13px] font-medium text-foreground">{t('mcpServers.registry.error.title')}</p>
                <p className="text-xs text-muted-foreground">{t('mcpServers.registry.error.description')}</p>
                <Button size="sm" variant="outline" className="mt-2" onClick={onRetry}>
                  <RefreshIcon />
                  {t('mcpServers.registry.action.retry')}
                </Button>
              </div>
            )
          : candidates.length === 0
            ? (
                <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-foreground/10 bg-muted/20 px-6 py-10 text-center text-xs text-muted-foreground">
                  {t('mcpServers.registry.empty')}
                </div>
              )
            : (
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {candidates.map(candidate => (
                    <CandidateCard key={candidate.name} candidate={candidate} onInstall={onInstall} />
                  ))}
                </div>
              )}

      {hasNextPage && !isLoading && !isError && (
        <div className="flex justify-center">
          <Button size="sm" variant="outline" onClick={onLoadMore} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? <Spinner /> : null}
            {t('mcpServers.registry.loadMore')}
          </Button>
        </div>
      )}
    </div>
  )
}
