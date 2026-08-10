import { FileMusicLine as FileAudioIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'

import { formatChronicleAudioTranscriptStatus } from './chronicle-audio-presenter'
import { formatChronicleDateTime } from './chronicle-time-presenter'
import type { ChronicleAudioTranscript, ChronicleSpeakerProfile } from './use-chronicle'

export interface ChronicleAudioTranscriptCardViewProps {
  transcript: ChronicleAudioTranscript
  speakerProfiles: ChronicleSpeakerProfile[]
  assigningSpeaker: boolean
  onAssignSpeaker: (segmentId: string, speakerProfileId: string | null) => Promise<void>
}

export function ChronicleAudioTranscriptCardView({
  transcript,
  speakerProfiles,
  assigningSpeaker,
  onAssignSpeaker,
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
      {transcript.segments.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-border/60 pt-2.5">
          {transcript.segments.map(segment => (
            <div key={segment.id} className="grid gap-1.5 rounded-md bg-muted/35 p-2">
              <select
                className="h-7 w-full rounded-md border border-border bg-background px-2 text-[12px] text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                value={segment.speakerProfileId ?? ''}
                disabled={assigningSpeaker}
                aria-label={t('audioTranscript.assignSpeaker')}
                onChange={event => void onAssignSpeaker(segment.id, event.target.value || null)}
              >
                <option value="">{t('audioTranscript.unknownSpeaker')}</option>
                {speakerProfiles.map(profile => (
                  <option key={profile.id} value={profile.id}>{profile.displayName}</option>
                ))}
              </select>
              <p className="text-[12px] leading-4 text-foreground">{segment.text}</p>
            </div>
          ))}
        </div>
      )}
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
