import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SidebarUpdateButtonView } from '~/components/layout/sidebar-update-button-view'
import { toastManager } from '~/components/ui/toast'
import { isActiveDownload } from '~/features/download-center/types'
import { useDownloadCenterOwner } from '~/features/download-center/use-download-center'
import type { DesktopUpdateStatus } from '~/lib/electron'
import { isElectron, nativeIpc, subscribeDesktopUpdateStatus } from '~/lib/electron'
import { openSettingsSection } from '~/navigation/navigation-commands'

const EMPTY_UPDATE_STATUS: DesktopUpdateStatus = {
  unsupported: true,
  provider: null,
  currentVersion: '0.0.0',
  isCheckingForUpdates: false,
  isPreparingUpdate: false,
  updateDownloaded: false,
  updateInfo: null,
  errorMessage: null,
}

export function SidebarUpdateButton({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation('chrome')
  const [status, setStatus] = useState<DesktopUpdateStatus>(EMPTY_UPDATE_STATUS)
  const downloadTasks = useDownloadCenterOwner({ namespace: 'desktop-update' })
  const notifiedVersionRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isElectron || !nativeIpc) {
      return undefined
    }

    let mounted = true
    void nativeIpc.desktopUpdate.getStatus().then((nextStatus) => {
      if (mounted) {
        setStatus(nextStatus)
      }
    }).catch(() => {})

    const unsubscribe = subscribeDesktopUpdateStatus(setStatus)

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const version = status.updateInfo?.version ?? null
    if (!version || notifiedVersionRef.current === version) {
      return
    }

    notifiedVersionRef.current = version
    toastManager.add({
      type: 'info',
      title: t('update.toast.availableTitle', { version }),
      description: t('update.toast.availableDescription'),
    })
  }, [status.updateInfo?.version, t])

  const updateDownload = downloadTasks.find(task => task.scope === 'desktop'
    && task.owner.namespace === 'desktop-update'
    && (task.owner.resourceType === 'macos-update' || task.owner.resourceType === 'windows-update')
    && isActiveDownload(task))
  const hasUpdateNotice = !!status.updateInfo
    || !!updateDownload
    || status.isPreparingUpdate
    || status.updateDownloaded

  if (!isElectron || !hasUpdateNotice) {
    return null
  }

  const statusLabel = status.unsupported
    ? t('update.status.unavailable')
    : status.isCheckingForUpdates
      ? t('update.status.checking')
      : updateDownload
        ? t('update.status.downloading', {
            progress: updateDownload.totalBytes && updateDownload.totalBytes > 0
              ? Math.round((updateDownload.transferredBytes / updateDownload.totalBytes) * 100)
              : '—',
          })
        : status.isPreparingUpdate
          ? t('update.status.preparing')
          : status.updateDownloaded
            ? t('update.status.downloaded')
            : status.updateInfo
              ? t('update.status.available', { version: status.updateInfo.version })
              : t('update.status.current')

  return (
    <SidebarUpdateButtonView
      collapsed={collapsed}
      status={status}
      statusLabel={statusLabel}
      buttonLabel={t('update.button')}
      tooltipTitle={t('update.tooltip.title')}
      availableLabel={status.updateInfo
        ? t('update.tooltip.available', { version: status.updateInfo.version })
        : null}
      isDownloading={!!updateDownload}
      onOpen={() => openSettingsSection('desktop')}
    />
  )
}
