import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { isActiveDownload } from '~/features/download-center/types'
import { useDownloadCenterOwner } from '~/features/download-center/use-download-center'
import type { DesktopCliStatus, DesktopUpdateStatus } from '~/lib/electron'
import { isElectron, nativeIpc, subscribeDesktopUpdateStatus } from '~/lib/electron'

import { DesktopUpdateSettingsView } from './desktop-update-settings-view'
import { PreferredEditorSetting } from './preferred-editor-setting'
import type { DesktopPreferences } from './use-desktop-preferences'
import { useDesktopPreferences } from './use-desktop-preferences'

type SettingsKey = keyof typeof import('~/locales/default').default.settings

const EMPTY_UPDATE_STATUS: DesktopUpdateStatus = {
  unsupported: true,
  provider: null,
  currentVersion: '0.0.0',
  isCheckingForUpdates: false,
  isPreparingUpdate: false,
  updateDownloaded: false,
  updateInfo: null,
  errorMessage: 'Desktop updates are only available in the Electron app',
}

const EMPTY_CLI_STATUS: DesktopCliStatus = {
  supported: false,
  installed: false,
  linked: false,
  requiresRepair: false,
  commandPath: '/usr/local/bin/cradle',
  sourcePath: null,
  errorMessage: 'CLI installation is only available in the Electron app',
}

export function DesktopUpdateSettings() {
  const { t } = useTranslation('settings')
  const [status, setStatus] = useState<DesktopUpdateStatus>(EMPTY_UPDATE_STATUS)
  const [cliStatus, setCliStatus] = useState<DesktopCliStatus>(EMPTY_CLI_STATUS)
  const [statusReady, setStatusReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const downloadTasks = useDownloadCenterOwner({ namespace: 'desktop-update' })
  const {
    prefs: desktopPreferences,
    isSaving: isSavingDesktopPreferences,
    savePrefs: saveDesktopPreferences,
  } = useDesktopPreferences()

  const updateDownload = downloadTasks.find(task => task.scope === 'desktop'
    && task.owner.namespace === 'desktop-update'
    && (task.owner.resourceType === 'macos-update' || task.owner.resourceType === 'windows-update')
    && isActiveDownload(task)) ?? null
  const busy = loading
    || status.isCheckingForUpdates
    || !!updateDownload
    || status.isPreparingUpdate
  const isSparkle = status.provider === 'sparkle'
  const canCheck = isElectron && !!nativeIpc && !status.unsupported && !busy

  const updateStatusLabel = useMemo(() => {
    if (status.unsupported) {
      return t('desktop.updates.status.unavailable' as SettingsKey)
    }
    if (status.isCheckingForUpdates) {
      return t('desktop.updates.status.checking' as SettingsKey)
    }
    if (updateDownload) {
      return t('desktop.updates.status.downloading' as SettingsKey)
    }
    if (status.isPreparingUpdate) {
      return t('desktop.updates.status.preparing' as SettingsKey)
    }
    if (status.updateDownloaded) {
      return t('desktop.updates.status.ready' as SettingsKey)
    }
    if (status.updateInfo) {
      return t('desktop.updates.status.available' as SettingsKey)
    }
    return t('desktop.updates.status.current' as SettingsKey)
  }, [status, t, updateDownload])

  const cliStatusLabel = useMemo(() => {
    if (!cliStatus.supported) {
      return t('desktop.cli.status.unavailable' as SettingsKey)
    }
    if (cliStatus.installed) {
      return t('desktop.cli.status.installed' as SettingsKey)
    }
    if (cliStatus.requiresRepair) {
      return t('desktop.cli.status.repair' as SettingsKey)
    }
    return t('desktop.cli.status.notInstalled' as SettingsKey)
  }, [cliStatus, t])

  const refreshStatus = useCallback(async () => {
    if (!isElectron || !nativeIpc) {
      setStatus(EMPTY_UPDATE_STATUS)
      setCliStatus(EMPTY_CLI_STATUS)
      setStatusReady(true)
      return
    }

    setLoading(true)
    try {
      const [nextStatus, nextCliStatus] = await Promise.all([
        nativeIpc.desktopUpdate.getStatus(),
        nativeIpc.native.getDesktopCliStatus(),
      ])
      setStatus(nextStatus)
      setCliStatus(nextCliStatus)
      setStatusReady(true)
    }
    finally {
      setLoading(false)
    }
  }, [])

  const runCliAction = useCallback(async (action: () => Promise<DesktopCliStatus>) => {
    setLoading(true)
    try {
      setCliStatus(await action())
    }
    finally {
      setLoading(false)
    }
  }, [])

  const runUpdateAction = useCallback(async (
    action: () => Promise<DesktopUpdateStatus | void>,
  ) => {
    setLoading(true)
    try {
      const nextStatus = await action()
      if (nextStatus) {
        setStatus(nextStatus)
      }
    }
    finally {
      setLoading(false)
    }
  }, [])

  const savePreference = useCallback((updates: Partial<DesktopPreferences>) => {
    void saveDesktopPreferences(updates).then((updated) => {
      if (updated && isElectron && nativeIpc) {
        void nativeIpc.native.setDesktopPreferences(updated).catch(() => {})
      }
    })
  }, [saveDesktopPreferences])

  useEffect(() => {
    void refreshStatus()
    return subscribeDesktopUpdateStatus(setStatus)
  }, [refreshStatus])

  return (
    <DesktopUpdateSettingsView
      desktop={isElectron}
      statusReady={statusReady}
      status={status}
      cliStatus={cliStatus}
      updateDownload={updateDownload}
      desktopPreferences={desktopPreferences}
      preferencesDisabled={!desktopPreferences || isSavingDesktopPreferences}
      loading={loading}
      preferredEditorSetting={<PreferredEditorSetting />}
      capabilities={{
        refreshUpdate: !!nativeIpc && !busy,
        checkUpdate: canCheck,
        downloadUpdate: canCheck && !isSparkle && !!status.updateInfo && !status.updateDownloaded,
        applyUpdate: canCheck && !isSparkle && status.updateDownloaded,
        refreshCli: !!nativeIpc && !loading,
        removeCli: !!nativeIpc && !loading && cliStatus.supported && cliStatus.installed,
        installCli: !!nativeIpc && !loading && cliStatus.supported,
      }}
      labels={{
        pageTitle: t('desktop.page.title' as SettingsKey),
        pageDescription: t('desktop.page.description' as SettingsKey),
        desktopBadge: t('desktop.badge.desktop' as SettingsKey),
        doubleCommandQLabel: t('desktop.doubleCommandQ.label' as SettingsKey),
        doubleCommandQDescription: t('desktop.doubleCommandQ.description' as SettingsKey),
        autoCheckLabel: t('desktop.autoCheckForUpdates.label' as SettingsKey),
        autoCheckDescription: t('desktop.autoCheckForUpdates.description' as SettingsKey),
        externalTerminalLabel: t('desktop.externalTerminal.label' as SettingsKey),
        externalTerminalDescription: t('desktop.externalTerminal.description' as SettingsKey),
        externalTerminalPlaceholder: t('desktop.externalTerminal.placeholder' as SettingsKey),
        updatesTitle: t('desktop.updates.title' as SettingsKey),
        updateStatus: updateStatusLabel,
        currentVersion: t('desktop.updates.currentVersion' as SettingsKey),
        downloading: t('desktop.updates.status.downloading' as SettingsKey),
        availableVersion: t('desktop.updates.availableVersion' as SettingsKey),
        noUpdate: t('desktop.updates.none' as SettingsKey),
        releaseNotes: t('desktop.updates.releaseNotes' as SettingsKey),
        refreshUpdate: t('desktop.updates.actions.refresh' as SettingsKey),
        checkUpdate: t('desktop.updates.actions.check' as SettingsKey),
        downloadUpdate: t('desktop.updates.actions.download' as SettingsKey),
        restart: t('desktop.updates.actions.restart' as SettingsKey),
        cliTitle: t('desktop.cli.title' as SettingsKey),
        cliStatus: cliStatusLabel,
        refreshCli: t('desktop.cli.actions.refresh' as SettingsKey),
        removeCli: t('desktop.cli.actions.remove' as SettingsKey),
        repairCli: t('desktop.cli.actions.repair' as SettingsKey),
        installCli: t('desktop.cli.actions.install' as SettingsKey),
        webNotice: t('desktop.webNotice.description' as SettingsKey),
      }}
      onSetRequireDoubleCommandQ={(requireDoubleCommandQToQuit) => {
        savePreference({ requireDoubleCommandQToQuit })
      }}
      onSetAutoCheck={(autoCheckForUpdates) => {
        savePreference({ autoCheckForUpdates })
      }}
      onSetExternalTerminal={(externalTerminalApp) => {
        savePreference({ externalTerminalApp })
      }}
      onRefresh={() => void refreshStatus()}
      onCheckUpdate={() => {
        const ipc = nativeIpc
        if (ipc) {
          void runUpdateAction(() => ipc.desktopUpdate.checkForUpdates())
        }
      }}
      onDownloadUpdate={() => {
        const ipc = nativeIpc
        if (ipc) {
          void runUpdateAction(() => ipc.desktopUpdate.downloadUpdate())
        }
      }}
      onApplyUpdate={() => {
        const ipc = nativeIpc
        if (ipc) {
          void runUpdateAction(() => ipc.desktopUpdate.applyUpdate())
        }
      }}
      onRemoveCli={() => {
        const ipc = nativeIpc
        if (ipc) {
          void runCliAction(() => ipc.native.removeDesktopCliCommand())
        }
      }}
      onInstallCli={() => {
        const ipc = nativeIpc
        if (ipc) {
          void runCliAction(() => ipc.native.installDesktopCliCommand())
        }
      }}
    />
  )
}
