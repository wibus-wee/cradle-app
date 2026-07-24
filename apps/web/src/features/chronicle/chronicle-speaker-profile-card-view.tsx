import { User2Line as UserIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'

import { formatChronicleRelativeTime } from './chronicle-time-presenter'
import type { ChronicleSpeakerProfile } from './use-chronicle'

export interface ChronicleSpeakerProfileCardViewProps {
  profile: ChronicleSpeakerProfile
}

export function ChronicleSpeakerProfileCardView({
  profile,
}: ChronicleSpeakerProfileCardViewProps) {
  const { t } = useTranslation('chronicle')

  return (
    <article className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <UserIcon className="size-3.5 shrink-0 !text-muted-foreground" />
        <span className="truncate text-[13px] font-medium text-foreground">
          {profile.displayName}
        </span>
        <Badge variant="outline" className="ml-auto text-[11px]">
          {t('speaker.sampleCount', { count: profile.sampleCount })}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[12px] text-muted-foreground">
        <span className="truncate">
          {t('speaker.lastSeen')}
          {' '}
          {formatChronicleRelativeTime(t, profile.lastSeenAt)}
        </span>
        <span className="truncate text-right">
          {profile.embeddingDimensions
            ? t('speaker.embeddingDimensions', { count: profile.embeddingDimensions })
            : t('speaker.noVoiceprint')}
        </span>
        <span className="truncate">
          {profile.embeddingModelId ?? t('speaker.labelFallback')}
        </span>
        <span className="truncate text-right">
          {t('speaker.aliasCount', { count: profile.aliases.length })}
        </span>
      </div>
      {profile.aliases.length > 0 && (
        <p className="mt-2 truncate text-[11px] text-muted-foreground/70">
          {profile.aliases.join(', ')}
        </p>
      )}
    </article>
  )
}
