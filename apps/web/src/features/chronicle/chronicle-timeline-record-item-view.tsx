import {
  FileMusicLine as FileAudioIcon,
  Message1Line as MessageSquareIcon,
  PicLine as ImageIcon,
} from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'

import { formatChronicleDateTime } from './chronicle-time-presenter'
import {
  getChronicleTimelineEntrySecondaryLabel,
  getChronicleTimelineEntryTitle,
} from './chronicle-timeline-presenter'
import type { TimelineEntry } from './use-chronicle'

export interface ChronicleTimelineRecordItemViewProps {
  entry: TimelineEntry
  frameUrl: string
}

export function ChronicleTimelineRecordItemView({
  entry,
  frameUrl,
}: ChronicleTimelineRecordItemViewProps) {
  const { t } = useTranslation('chronicle')
  const sourceType = entry.sourceType ?? 'snapshot'
  const isSnapshot = sourceType === 'snapshot'
  const sourceLabel = sourceType === 'audio'
    ? t('timeline.source.audio')
    : sourceType === 'message'
      ? t('timeline.source.message')
      : t('timeline.source.snapshot')
  const title = getChronicleTimelineEntryTitle(t, entry)
  const secondary = getChronicleTimelineEntrySecondaryLabel(t, entry)

  return (
    <article className="grid min-h-[96px] grid-cols-[92px_minmax(0,1fr)] gap-3 rounded-lg bg-background p-2.5 shadow-[0_0_0_1px_rgba(0,0,0,0.06)] transition-shadow hover:shadow-[0_0_0_1px_rgba(0,0,0,0.1)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06)] dark:hover:shadow-[0_0_0_1px_rgba(255,255,255,0.1)] sm:grid-cols-[120px_minmax(0,1fr)]">
      <div className="h-[52px] w-[92px] overflow-hidden rounded-md bg-muted text-muted-foreground shadow-[0_0_0_1px_rgba(0,0,0,0.1)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.1)] sm:h-[68px] sm:w-[120px]">
        {isSnapshot && entry.framePath
          ? (
              <img
                src={frameUrl}
                alt={t('timeline.frameAlt', {
                  time: formatChronicleDateTime(t, entry.capturedAt),
                })}
                className="size-full object-contain"
                loading="lazy"
              />
            )
          : (
              <div className="flex size-full items-center justify-center">
                {sourceType === 'audio'
                  ? <FileAudioIcon className="size-4" />
                  : sourceType === 'message'
                    ? <MessageSquareIcon className="size-4" />
                    : <ImageIcon className="size-4" />}
              </div>
            )}
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px]">
            {sourceLabel}
          </Badge>
          <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px] tabular-nums">
            {t('timeline.displayLabel', { displayId: entry.displayId })}
          </Badge>
          <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
            {new Date(entry.capturedAt).toLocaleTimeString()}
          </span>
        </div>

        <h4 className="truncate text-[13px] font-medium text-foreground">{title}</h4>
        {secondary && <p className="truncate text-[11px] text-muted-foreground">{secondary}</p>}
        {entry.ocrText
          ? (
              <p className="line-clamp-2 text-[12px] leading-5 text-muted-foreground">
                {entry.ocrText}
              </p>
            )
          : !entry.framePath && (
              <p className="text-[12px] text-muted-foreground">
                {t('timeline.frameUnavailable')}
              </p>
            )}
      </div>
    </article>
  )
}
