import {
  BrainLine as BrainIcon,
  SearchLine as SearchIcon,
} from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Input } from '~/components/ui/input'

import { ChronicleEmptyState } from './chronicle-empty-state'
import { ChronicleMemoryListView } from './chronicle-memory-list-view'
import type { MemoryEntry } from './use-chronicle'

export interface ChronicleMemorySearchViewProps {
  query: string
  loading: boolean
  entries: MemoryEntry[]
  focusedMemoryId: string | null
  onQueryChange: (query: string) => void
}

export function ChronicleMemorySearchView({
  query,
  loading,
  entries,
  focusedMemoryId,
  onQueryChange,
}: ChronicleMemorySearchViewProps) {
  const { t } = useTranslation('chronicle')
  const hasQuery = query.trim().length > 0

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 !text-muted-foreground/60" />
        <Input
          value={query}
          onChange={event => onQueryChange(event.target.value)}
          placeholder={t('memorySearch.placeholder')}
          className="h-9 pl-8 text-[13px]"
        />
      </div>
      {loading
        ? (
            <ChronicleEmptyState
              icon={<BrainIcon className="size-4" />}
              title={t('memorySearch.loading')}
            />
          )
        : entries.length === 0
          ? (
              <ChronicleEmptyState
                icon={<BrainIcon className="size-4" />}
                title={hasQuery ? t('memorySearch.noMatches') : t('memorySearch.empty')}
              />
            )
          : (
              <ChronicleMemoryListView
                entries={entries}
                focusedMemoryId={focusedMemoryId}
              />
            )}
    </div>
  )
}
