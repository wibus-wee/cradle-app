import {
  DownloadLine as DownloadIcon,
  InformationLine as InformationIcon,
  UploadLine as UploadIcon,
} from '@mingcute/react'

import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'

import { SettingsGroup, SettingsPage } from './settings-container'
import { SettingsRow } from './settings-row'

export interface DataBackupSettingsViewCopy {
  title: string
  description: string
  badge: string
  noticeTitle: string
  noticeDescription: string
  exportLabel: string
  exportDescription: string
  exportAction: string
  restoreLabel: string
  restoreDescription: string
  restoreAction: string
  unavailable: string
  confirmTitle: string
  confirmDescription: string
  confirmCancel: string
  confirmAction: string
}

export interface DataBackupSettingsViewProps {
  copy: DataBackupSettingsViewCopy
  available: boolean
  busy: boolean
  statusMessage: string | null
  statusTone: 'neutral' | 'error'
  pendingRestorePath: string | null
  onExport: () => void
  onChooseRestore: () => void
  onCancelRestore: () => void
  onConfirmRestore: () => void
}

/** Fixture-driven backup and restore surface. Native dialogs and restart scheduling stay in the container. */
export function DataBackupSettingsView({
  copy,
  available,
  busy,
  statusMessage,
  statusTone,
  pendingRestorePath,
  onExport,
  onChooseRestore,
  onCancelRestore,
  onConfirmRestore,
}: DataBackupSettingsViewProps) {
  return (
    <SettingsPage
      title={copy.title}
      description={copy.description}
      action={<Badge variant="outline">{copy.badge}</Badge>}
      data-testid="data-backup-settings"
    >
      <Alert>
        <InformationIcon className="size-4" aria-hidden="true" />
        <AlertTitle>{copy.noticeTitle}</AlertTitle>
        <AlertDescription>{copy.noticeDescription}</AlertDescription>
      </Alert>

      <SettingsGroup>
        <SettingsRow label={copy.exportLabel} description={copy.exportDescription}>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!available || busy}
            onClick={onExport}
          >
            {busy ? <Spinner className="size-3.5" /> : <DownloadIcon className="size-3.5" aria-hidden="true" />}
            {copy.exportAction}
          </Button>
        </SettingsRow>

        <SettingsRow label={copy.restoreLabel} description={copy.restoreDescription}>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!available || busy}
            onClick={onChooseRestore}
          >
            <UploadIcon className="size-3.5" aria-hidden="true" />
            {copy.restoreAction}
          </Button>
        </SettingsRow>
      </SettingsGroup>

      {!available && (
        <p className="text-[12px] text-muted-foreground">{copy.unavailable}</p>
      )}

      {statusMessage && (
        <Alert variant={statusTone === 'error' ? 'destructive' : 'default'}>
          <AlertDescription className="break-words">{statusMessage}</AlertDescription>
        </Alert>
      )}

      <AlertDialog
        open={pendingRestorePath !== null}
        onOpenChange={open => !open && onCancelRestore()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{copy.confirmDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onCancelRestore}>{copy.confirmCancel}</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmRestore} disabled={busy}>
              {copy.confirmAction}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPage>
  )
}
