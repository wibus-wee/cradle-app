import { DeleteLine as DeleteIcon, MicOffLine as MicOffIcon, PencilLine as PencilIcon, User2Line as UserIcon } from '@mingcute/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '~/components/ui/alert-dialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'

import { formatChronicleRelativeTime } from './chronicle-time-presenter'
import type { ChronicleSpeakerProfile } from './use-chronicle'

export interface ChronicleSpeakerProfileCardViewProps {
  profile: ChronicleSpeakerProfile
  busy: boolean
  onRename: (profileId: string, displayName: string) => Promise<void>
  onDeleteVoiceprint: (profileId: string) => Promise<void>
  onDeleteProfile: (profileId: string) => Promise<void>
}

export function ChronicleSpeakerProfileCardView({
  profile,
  busy,
  onRename,
  onDeleteVoiceprint,
  onDeleteProfile,
}: ChronicleSpeakerProfileCardViewProps) {
  const { t } = useTranslation('chronicle')
  const [renameOpen, setRenameOpen] = useState(false)
  const [displayName, setDisplayName] = useState(profile.displayName)

  const submitRename = async () => {
    const nextDisplayName = displayName.trim()
    if (!nextDisplayName) {
      return
    }
    await onRename(profile.id, nextDisplayName)
    setRenameOpen(false)
  }

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
      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-2.5">
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={busy}
          onClick={() => {
            setDisplayName(profile.displayName)
            setRenameOpen(true)
          }}
        >
          <PencilIcon aria-hidden="true" />
          {t('speaker.rename')}
        </Button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="outline" size="xs" disabled={busy || !profile.hasVoiceprint}>
              <MicOffIcon aria-hidden="true" />
              {t('speaker.deleteVoiceprint')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('speaker.deleteVoiceprintTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('speaker.deleteVoiceprintDescription')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('speaker.cancel')}</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => void onDeleteVoiceprint(profile.id)}>
                {t('speaker.deleteVoiceprint')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="destructive" size="xs" disabled={busy} className="ml-auto">
              <DeleteIcon aria-hidden="true" />
              {t('speaker.deleteProfile')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('speaker.deleteProfileTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('speaker.deleteProfileDescription')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('speaker.cancel')}</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => void onDeleteProfile(profile.id)}>
                {t('speaker.deleteProfile')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('speaker.renameTitle')}</DialogTitle>
            <DialogDescription>{t('speaker.renameDescription')}</DialogDescription>
          </DialogHeader>
          <Input
            value={displayName}
            disabled={busy}
            aria-label={t('speaker.displayName')}
            onChange={event => setDisplayName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submitRename()
              }
            }}
          />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setRenameOpen(false)}>
              {t('speaker.cancel')}
            </Button>
            <Button type="button" disabled={busy || !displayName.trim()} onClick={() => void submitRename()}>
              {t('speaker.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  )
}
