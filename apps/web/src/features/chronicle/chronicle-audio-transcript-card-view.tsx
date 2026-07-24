import { FileMusicLine as FileAudioIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'

import { formatChronicleAudioTranscriptStatus } from './chronicle-audio-presenter'
import { formatChronicleDateTime } from './chronicle-time-presenter'
import type { ChronicleAudioTranscript } from './use-chronicle'

export interface ChronicleAudioTranscriptCardViewProps {
  transcript: ChronicleAudioTranscript
}

export function ChronicleAudioTranscriptCardView({
  transcript,
}: ChronicleAudioTranscriptCardViewProps) {
  const { t } = useTranslation('chronicle')

  return (
    <article className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <FileAudioIcon className="size-3.5 shrink-0 !text-muted-foreground" />
        <span className="truncate text-[13px] font-medium text-foreground">
          {transcript.title ?? transcript.windowTitle ?? t('timeline.fallback.audioTranscript')}
        </span>
        <Badge variant="outline" className="ml-auto text-[11px]">
          {formatChronicleAudioTranscriptStatus(t, transcript.status)}
        </Badge>
      </div>
      <p className="line-clamp-4 text-[13px] leading-5 text-foreground">
        {transcript.previewText || t('audioTranscript.emptyPreview')}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="font-mono">
          {formatChronicleDateTime(t, transcript.startedAt)}
        </span>
        <span>
          {t('audioTranscript.segmentCount', { count: transcript.segmentCount })}
        </span>
        {transcript.language && <span>{transcript.language}</span>}
        {transcript.source === 'asr' && <span>{t('audioTranscript.asrTranscript')}</span>}
      </div>
    </article>
  )
}
