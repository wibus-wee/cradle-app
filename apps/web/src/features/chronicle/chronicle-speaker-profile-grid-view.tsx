import { User2Line as UserIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { ChronicleEmptyState } from './chronicle-empty-state'
import { ChronicleSpeakerProfileCardView } from './chronicle-speaker-profile-card-view'
import type { ChronicleSpeakerProfile } from './use-chronicle'

export interface ChronicleSpeakerProfileGridViewProps {
  loading: boolean
  busy: boolean
  profiles: ChronicleSpeakerProfile[]
  onRename: (profileId: string, displayName: string) => Promise<void>
  onDeleteVoiceprint: (profileId: string) => Promise<void>
  onDeleteProfile: (profileId: string) => Promise<void>
}

export function ChronicleSpeakerProfileGridView({
  loading,
  busy,
  profiles,
  onRename,
  onDeleteVoiceprint,
  onDeleteProfile,
}: ChronicleSpeakerProfileGridViewProps) {
  const { t } = useTranslation('chronicle')

  if (loading) {
    return (
      <ChronicleEmptyState
        icon={<UserIcon className="size-4" />}
        title={t('speakers.loading')}
      />
    )
  }
  if (profiles.length === 0) {
    return (
      <ChronicleEmptyState
        icon={<UserIcon className="size-4" />}
        title={t('speakers.empty')}
      />
    )
  }

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      {profiles.map(profile => (
        <ChronicleSpeakerProfileCardView
          key={profile.id}
          profile={profile}
          busy={busy}
          onRename={onRename}
          onDeleteVoiceprint={onDeleteVoiceprint}
          onDeleteProfile={onDeleteProfile}
        />
      ))}
    </div>
  )
}
