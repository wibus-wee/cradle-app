import { PicLine as ImageIcon } from '@mingcute/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'

import { ChronicleEmptyState } from './chronicle-empty-state'
import type { ChronicleTimelineSourceFilter } from './chronicle-timeline-presenter'
import {
  isChronicleTimelineSourceFilter,
} from './chronicle-timeline-presenter'
import { ChronicleTimelineRecordItemView } from './chronicle-timeline-record-item-view'
import type { TimelineEntry } from './use-chronicle'

export interface ChronicleTimelineFeedViewProps {
  entries: TimelineEntry[]
  frameUrlForEntry: (entry: TimelineEntry) => string
}

export function ChronicleTimelineFeedView({
  entries,
  frameUrlForEntry,
}: ChronicleTimelineFeedViewProps) {
  const { t } = useTranslation('chronicle')
  const [sourceFilter, setSourceFilter] = useState<ChronicleTimelineSourceFilter>('all')
  const [displayFilter, setDisplayFilter] = useState<number | null>(null)
  const displayIds = useMemo(
    () => Array.from(new Set(entries.map(entry => entry.displayId))).sort((left, right) => left - right),
    [entries],
  )
  const filteredEntries = useMemo(
    () => entries.filter((entry) => {
      const sourceType = entry.sourceType ?? 'snapshot'
      return (sourceFilter === 'all' || sourceType === sourceFilter)
        && (displayFilter === null || entry.displayId === displayFilter)
    }),
    [displayFilter, entries, sourceFilter],
  )

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 rounded-lg bg-muted/30 p-2 sm:flex-row sm:items-center sm:justify-between">
        <ToggleGroup
          type="single"
          value={sourceFilter}
          onValueChange={(value) => {
            if (isChronicleTimelineSourceFilter(value)) {
              setSourceFilter(value)
            }
          }}
          variant="outline"
          size="sm"
          spacing={0}
          aria-label={t('timeline.filter.source.ariaLabel')}
          className="w-full justify-start overflow-x-auto sm:w-auto"
        >
          <ToggleGroupItem value="all" aria-label={t('timeline.filter.all')} className="h-8 px-2 text-[11px]">
            {t('timeline.filter.all')}
          </ToggleGroupItem>
          <ToggleGroupItem value="snapshot" aria-label={t('timeline.source.snapshot')} className="h-8 px-2 text-[11px]">
            {t('timeline.source.snapshot')}
          </ToggleGroupItem>
          <ToggleGroupItem value="message" aria-label={t('timeline.source.message')} className="h-8 px-2 text-[11px]">
            {t('timeline.source.message')}
          </ToggleGroupItem>
          <ToggleGroupItem value="audio" aria-label={t('timeline.source.audio')} className="h-8 px-2 text-[11px]">
            {t('timeline.source.audio')}
          </ToggleGroupItem>
        </ToggleGroup>

        <select
          value={displayFilter === null ? 'all' : String(displayFilter)}
          aria-label={t('timeline.filter.display.ariaLabel')}
          className="h-8 rounded-md border border-border bg-background px-2 text-[12px] text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          disabled={displayIds.length <= 1}
          onChange={(event) => {
            setDisplayFilter(event.target.value === 'all' ? null : Number(event.target.value))
          }}
        >
          <option value="all">{t('timeline.filter.allDisplays')}</option>
          {displayIds.map(displayId => (
            <option key={displayId} value={displayId}>
              {t('timeline.displayLabel', { displayId })}
            </option>
          ))}
        </select>
      </div>

      <div className="max-h-[420px] overflow-y-auto overscroll-contain pr-1">
        {filteredEntries.length === 0
          ? (
              <ChronicleEmptyState
                icon={<ImageIcon className="size-4" />}
                title={t('timeline.filteredEmpty')}
              />
            )
          : (
              <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                {filteredEntries.map(entry => (
                  <ChronicleTimelineRecordItemView
                    key={`${entry.sourceType ?? 'snapshot'}:${entry.id}`}
                    entry={entry}
                    frameUrl={frameUrlForEntry(entry)}
                  />
                ))}
              </div>
            )}
      </div>
    </div>
  )
}
