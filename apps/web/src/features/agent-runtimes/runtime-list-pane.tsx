import {
  CloseLine as XIcon,
  SearchLine as SearchIcon,
} from '@mingcute/react'
import { m } from 'motion/react'
import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { RuntimeIcon } from '~/components/common/provider-icons'
import { Button } from '~/components/ui/button'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '~/components/ui/input-group'
import { Skeleton } from '~/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import type { RuntimeCatalogItem } from '~/features/agent-runtime/use-runtime-catalog'
import { cn } from '~/lib/cn'

import { AcpAgentIcon } from './acp-agent-icon'
import type { AcpInstalledAgent, AcpRegistryAgent } from './use-acp-registry'

export type RuntimeSelection
  = | { type: 'builtin', runtimeKind: string }
    | { type: 'acp', agentId: string }

export interface AcpListEntry {
  agent: AcpRegistryAgent
  installed: AcpInstalledAgent | undefined
  updateAvailable: boolean
}

export type AcpListFilter = 'all' | 'installed' | 'updates'

const STAGGER_CAP = 10

export function ExperimentalChip({ className }: { className?: string }) {
  const { t } = useTranslation('runtimes')
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300',
        className,
      )}
    >
      {t('chip.experimental')}
    </span>
  )
}

function matchesQuery(query: string, fields: Array<string | null | undefined>): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) {
    return true
  }
  return fields.some(field => field?.toLowerCase().includes(normalized))
}

function selectionKey(selection: RuntimeSelection): string {
  return selection.type === 'builtin' ? `builtin:${selection.runtimeKind}` : `acp:${selection.agentId}`
}

export function RuntimeListPane({
  builtinRuntimes,
  acpEntries,
  isAcpLoading,
  selection,
  onSelect,
  search,
  onSearchChange,
  acpFilter,
  onAcpFilterChange,
}: {
  builtinRuntimes: RuntimeCatalogItem[]
  acpEntries: AcpListEntry[]
  isAcpLoading: boolean
  selection: RuntimeSelection | null
  onSelect: (selection: RuntimeSelection) => void
  search: string
  onSearchChange: (value: string) => void
  acpFilter: AcpListFilter
  onAcpFilterChange: (filter: AcpListFilter) => void
}) {
  const { t } = useTranslation('runtimes')
  const rowElementsRef = useRef(new Map<string, HTMLButtonElement>())

  const visibleBuiltin = useMemo(
    () => builtinRuntimes.filter(runtime =>
      matchesQuery(search, [runtime.label, runtime.description, runtime.runtimeKind])),
    [builtinRuntimes, search],
  )

  const visibleAcp = useMemo(() => {
    return acpEntries.filter((entry) => {
      if (acpFilter === 'installed' && !entry.installed) {
        return false
      }
      if (acpFilter === 'updates' && !entry.updateAvailable) {
        return false
      }
      return matchesQuery(search, [entry.agent.name, entry.agent.description, entry.agent.id])
    })
  }, [acpEntries, acpFilter, search])

  const flatSelections = useMemo<RuntimeSelection[]>(() => [
    ...visibleBuiltin.map(runtime => ({ type: 'builtin', runtimeKind: runtime.runtimeKind }) as const),
    ...visibleAcp.map(entry => ({ type: 'acp', agentId: entry.agent.id }) as const),
  ], [visibleBuiltin, visibleAcp])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return
    }
    if (flatSelections.length === 0) {
      return
    }
    event.preventDefault()
    const currentIndex = selection
      ? flatSelections.findIndex(item => selectionKey(item) === selectionKey(selection))
      : -1
    const nextIndex = event.key === 'ArrowDown'
      ? Math.min(currentIndex + 1, flatSelections.length - 1)
      : Math.max(currentIndex <= 0 ? 0 : currentIndex - 1, 0)
    const next = flatSelections[nextIndex]
    if (!next) {
      return
    }
    onSelect(next)
    rowElementsRef.current.get(selectionKey(next))?.scrollIntoView({ block: 'nearest' })
  }

  const searchActive = search.trim().length > 0
  const noMatches = !isAcpLoading && searchActive && visibleBuiltin.length === 0 && visibleAcp.length === 0

  let rowIndex = 0

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={handleKeyDown}>
      {/* Search */}
      <div className="flex flex-col gap-2 p-2 pb-1">
        <InputGroup>
          <InputGroupAddon align="inline-start">
            <SearchIcon className="size-3.5" />
          </InputGroupAddon>
          <InputGroupInput
            value={search}
            onChange={event => onSearchChange(event.target.value)}
            placeholder={t('search.placeholder')}
            data-testid="runtimes-search"
          />
          {search && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label={t('search.clear')}
                onClick={() => onSearchChange('')}
              >
                <XIcon className="size-3" />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>

        <ToggleGroup
          type="single"
          size="sm"
          value={acpFilter}
          onValueChange={(value) => {
            if (value) {
              onAcpFilterChange(value as AcpListFilter)
            }
          }}
          className="w-full"
        >
          <ToggleGroupItem value="all" className="h-6 flex-1 rounded-md px-2 text-[11px]">
            {t('filter.all')}
          </ToggleGroupItem>
          <ToggleGroupItem value="installed" className="h-6 flex-1 rounded-md px-2 text-[11px]">
            {t('filter.installed')}
          </ToggleGroupItem>
          <ToggleGroupItem value="updates" className="h-6 flex-1 rounded-md px-2 text-[11px]">
            {t('filter.updates')}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2 pt-1" data-testid="runtimes-list">
        {noMatches
          ? (
                <Empty className="mt-6 border-none">
                  <EmptyMedia variant="icon">
                    <SearchIcon />
                  </EmptyMedia>
                  <EmptyTitle>{t('empty.search.title')}</EmptyTitle>
                  <EmptyDescription>{t('empty.search.description')}</EmptyDescription>
                  <Button size="sm" variant="outline" onClick={() => onSearchChange('')}>
                    {t('empty.search.clear')}
                  </Button>
                </Empty>
              )
            : (
                <>
                  {visibleBuiltin.length > 0 && (
                    <GroupHeader label={t('group.builtin')} />
                  )}
                  {visibleBuiltin.map((runtime) => {
                    const index = rowIndex++
                    const key = `builtin:${runtime.runtimeKind}`
                    const selected = selection?.type === 'builtin' && selection.runtimeKind === runtime.runtimeKind
                    return (
                      <m.button
                        key={key}
                        ref={(node: HTMLButtonElement | null) => {
                          if (node) { rowElementsRef.current.set(key, node) }
                          else { rowElementsRef.current.delete(key) }
                        }}
                        type="button"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          type: 'spring',
                          stiffness: 600,
                          damping: 40,
                          delay: Math.min(index, STAGGER_CAP) * 0.05,
                        }}
                        onClick={() => onSelect({ type: 'builtin', runtimeKind: runtime.runtimeKind })}
                        data-testid={`runtime-row-${runtime.runtimeKind}`}
                        className={cn(
                          'flex min-h-10 w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none',
                          'focus-visible:ring-2 focus-visible:ring-ring/50',
                          selected ? 'bg-fill' : 'hover:bg-fill/60',
                        )}
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-fill">
                          <RuntimeIcon icon={runtime.icon} className="size-4.5" />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                          {runtime.label}
                        </span>
                        {runtime.stability === 'experimental' && <ExperimentalChip />}
                      </m.button>
                    )
                  })}

                  {(isAcpLoading || visibleAcp.length > 0) && (
                    <GroupHeader label={t('group.acpRegistry')} className="mt-2" />
                  )}
                  {isAcpLoading
                    ? (
                        <div className="flex flex-col gap-1 pt-1">
                          {Array.from({ length: 6 }, (_, index) => (
                            <div key={index} className="flex items-center gap-2.5 px-2 py-2">
                              <Skeleton className="size-8 rounded-md" />
                              <div className="flex flex-1 flex-col gap-1.5">
                                <Skeleton className="h-3 w-2/5" />
                                <Skeleton className="h-2.5 w-3/5" />
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    : visibleAcp.map((entry) => {
                    const index = rowIndex++
                    const key = `acp:${entry.agent.id}`
                    const selected = selection?.type === 'acp' && selection.agentId === entry.agent.id
                    return (
                      <m.button
                        key={key}
                        ref={(node: HTMLButtonElement | null) => {
                          if (node) { rowElementsRef.current.set(key, node) }
                          else { rowElementsRef.current.delete(key) }
                        }}
                        type="button"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          type: 'spring',
                          stiffness: 600,
                          damping: 40,
                          delay: Math.min(index, STAGGER_CAP) * 0.05,
                        }}
                        onClick={() => onSelect({ type: 'acp', agentId: entry.agent.id })}
                        data-testid={`acp-row-${entry.agent.id}`}
                        className={cn(
                          'flex min-h-10 w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none',
                          'focus-visible:ring-2 focus-visible:ring-ring/50',
                          selected ? 'bg-fill' : 'hover:bg-fill/60',
                        )}
                      >
                        <AcpAgentIcon
                          iconUrl={entry.agent.icon}
                          className="size-8"
                        />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                          {entry.agent.name}
                        </span>
                        {entry.installed
                          ? entry.updateAvailable
                            ? (
                                <span className="flex shrink-0 items-center gap-1.5">
                                  <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />
                                  <span className="font-mono text-[11px] tabular-nums text-text-tertiary">
                                    v
                                    {entry.agent.version}
                                  </span>
                                </span>
                              )
                            : (
                                <span className="shrink-0 font-mono text-[11px] tabular-nums text-text-tertiary">
                                  {entry.installed.version ? `v${entry.installed.version}` : '—'}
                                </span>
                              )
                          : null}
                      </m.button>
                    )
                  })}
                </>
              )}
      </div>
    </div>
  )
}

function GroupHeader({ label, className }: { label: string, className?: string }) {
  return (
    <div
      className={cn(
        'sticky top-0 z-10 -mx-2 bg-card px-4 pt-1.5 pb-1 text-[11px] font-medium text-text-tertiary select-none',
        className,
      )}
    >
      {label}
    </div>
  )
}
