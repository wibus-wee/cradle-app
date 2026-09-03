import type { TFunction } from 'i18next'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { CradleDataBackupStatus } from '~/lib/electron'
import { isElectron, nativeIpc } from '~/lib/electron'

import type { DataBackupSettingsViewCopy } from './data-backup-settings-view'
import { DataBackupSettingsView } from './data-backup-settings-view'

function formatBackupStatus(
  status: CradleDataBackupStatus | null,
  t: TFunction<'settings'>,
): { message: string | null, tone: 'neutral' | 'error' } {
  if (!status || status.phase === 'idle') {
    return { message: null, tone: 'neutral' }
  }
  if (status.phase === 'failed') {
    return {
      message: t('backup.status.failed', { message: status.errorMessage ?? t('backup.status.unknownError') }),
      tone: 'error',
    }
  }
  if (status.phase === 'completed' && status.kind === 'export') {
    return {
      message: t('backup.status.exported', { path: status.archivePath ?? '' }),
      tone: 'neutral',
    }
  }
  if (status.phase === 'completed' && status.kind === 'restore') {
    return {
      message: t('backup.status.restored', { backupPath: status.backupRoot ?? '' }),
      tone: 'neutral',
    }
  }
  return { message: t('backup.status.pending'), tone: 'neutral' }
}

export function DataBackupSettings() {
  const { t } = useTranslation('settings')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<CradleDataBackupStatus | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [pendingRestorePath, setPendingRestorePath] = useState<string | null>(null)
  const available = isElectron && !!nativeIpc

  useEffect(() => {
    if (!nativeIpc) {
      return
    }
    void nativeIpc.native.getCradleDataBackupStatus()
      .then(setStatus)
      .catch(error => setLocalError(error instanceof Error ? error.message : String(error)))
  }, [])

  const copy = useMemo<DataBackupSettingsViewCopy>(() => ({
    title: t('backup.page.title'),
    description: t('backup.page.description'),
    badge: t('backup.badge.local'),
    noticeTitle: t('backup.notice.title'),
    noticeDescription: t('backup.notice.description'),
    exportLabel: t('backup.export.label'),
    exportDescription: t('backup.export.description'),
    exportAction: t('backup.export.action'),
    restoreLabel: t('backup.restore.label'),
    restoreDescription: t('backup.restore.description'),
    restoreAction: t('backup.restore.action'),
    unavailable: t('backup.unavailable'),
    showExport: t('backup.status.showExport'),
    confirmTitle: t('backup.restore.confirmTitle'),
    confirmDescription: t('backup.restore.confirmDescription', { path: pendingRestorePath ?? '' }),
    confirmCancel: t('backup.restore.cancel'),
    confirmAction: t('backup.restore.confirm'),
  }), [pendingRestorePath, t])

  const formattedStatus = localError
    ? { message: localError, tone: 'error' as const }
    : formatBackupStatus(status, t)
  const exportedArchivePath
    = status?.phase === 'completed' && status.kind === 'export' ? status.archivePath : null

  const showExport = async () => {
    if (!nativeIpc || !exportedArchivePath) {
      return
    }
    setLocalError(null)
    try {
      await nativeIpc.native.showItemInFolder(exportedArchivePath)
    }
    catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error))
    }
  }

  const exportBackup = async () => {
    if (!nativeIpc) {
      return
    }
    setBusy(true)
    setLocalError(null)
    try {
      const choice = await nativeIpc.native.chooseCradleDataBackupDestination()
      if (choice.canceled || !choice.filePath) {
        setBusy(false)
        return
      }
      await nativeIpc.native.scheduleCradleDataBackupExport(choice.filePath)
    }
    catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error))
      setBusy(false)
    }
  }

  const chooseRestore = async () => {
    if (!nativeIpc) {
      return
    }
    setBusy(true)
    setLocalError(null)
    try {
      const choice = await nativeIpc.native.chooseCradleDataBackupToRestore()
      if (!choice.canceled && choice.filePath) {
        setPendingRestorePath(choice.filePath)
      }
    }
    catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error))
    }
    finally {
      setBusy(false)
    }
  }

  const confirmRestore = async () => {
    if (!nativeIpc || !pendingRestorePath) {
      return
    }
    setBusy(true)
    setLocalError(null)
    try {
      await nativeIpc.native.scheduleCradleDataBackupRestore(pendingRestorePath)
      setPendingRestorePath(null)
    }
    catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error))
      setBusy(false)
    }
  }

  return (
    <DataBackupSettingsView
      copy={copy}
      available={available}
      busy={busy}
      statusMessage={formattedStatus.message}
      statusTone={formattedStatus.tone}
      exportedArchivePath={exportedArchivePath}
      pendingRestorePath={pendingRestorePath}
      onExport={() => void exportBackup()}
      onChooseRestore={() => void chooseRestore()}
      onShowExport={() => void showExport()}
      onCancelRestore={() => setPendingRestorePath(null)}
      onConfirmRestore={() => void confirmRestore()}
    />
  )
}
