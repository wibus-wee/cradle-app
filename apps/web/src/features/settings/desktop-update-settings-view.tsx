import { StaticRender } from '@cradle/streamdown'
import {
  DownloadLine as DownloadIcon,
  MonitorLine as MonitorIcon,
  PackageLine as PackageCheckIcon,
  Refresh1Line as RefreshCwIcon,
  TerminalLine as TerminalIcon,
  UnlinkLine as UnlinkIcon,
} from '@mingcute/react'
import { useEffect, useState } from 'react'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import type { DownloadTask } from '~/features/download-center/types'
import type { DesktopCliStatus, DesktopUpdateStatus } from '~/lib/electron'
import { formatCompactBytes } from '~/lib/number-format'

import { DesktopOperationsCard } from './desktop-operations-card'
import { SettingsGroup, SettingsPage } from './settings-container'
import { SettingsRow } from './settings-row'
import type { DesktopPreferences } from './use-desktop-preferences'

interface DesktopUpdateSettingsViewProps {
  desktop: boolean
  statusReady: boolean
  status: DesktopUpdateStatus
  cliStatus: DesktopCliStatus
  updateDownload: DownloadTask | null
  desktopPreferences: DesktopPreferences | null
  preferencesDisabled?: boolean
  loading?: boolean
  preferredEditorSetting?: React.ReactNode
  capabilities: {
    refreshUpdate: boolean
    checkUpdate: boolean
    downloadUpdate: boolean
    applyUpdate: boolean
    refreshCli: boolean
    removeCli: boolean
    installCli: boolean
  }
  labels: {
    pageTitle: string
    pageDescription: string
    desktopBadge: string
    doubleCommandQLabel: string
    doubleCommandQDescription: string
    autoCheckLabel: string
    autoCheckDescription: string
    externalTerminalLabel: string
    externalTerminalDescription: string
    externalTerminalPlaceholder: string
    updatesTitle: string
    updateStatus: string
    currentVersion: string
    downloading: string
    availableVersion: string
    noUpdate: string
    releaseNotes: string
    refreshUpdate: string
    checkUpdate: string
    downloadUpdate: string
    restart: string
    cliTitle: string
    cliStatus: string
    refreshCli: string
    removeCli: string
    repairCli: string
    installCli: string
    webNotice: string
  }
  onSetRequireDoubleCommandQ: (enabled: boolean) => void
  onSetAutoCheck: (enabled: boolean) => void
  onSetExternalTerminal: (application: string | null) => void
  onRefresh: () => void
  onCheckUpdate: () => void
  onDownloadUpdate: () => void
  onApplyUpdate: () => void
  onRemoveCli: () => void
  onInstallCli: () => void
}

export function DesktopUpdateSettingsView({
  desktop,
  statusReady,
  status,
  cliStatus,
  updateDownload,
  desktopPreferences,
  preferencesDisabled = false,
  loading = false,
  preferredEditorSetting,
  capabilities,
  labels,
  onSetRequireDoubleCommandQ,
  onSetAutoCheck,
  onSetExternalTerminal,
  onRefresh,
  onCheckUpdate,
  onDownloadUpdate,
  onApplyUpdate,
  onRemoveCli,
  onInstallCli,
}: DesktopUpdateSettingsViewProps) {
  const [terminalApplication, setTerminalApplication] = useState(
    desktopPreferences?.externalTerminalApp ?? '',
  )

  useEffect(() => {
    setTerminalApplication(desktopPreferences?.externalTerminalApp ?? '')
  }, [desktopPreferences?.externalTerminalApp])

  const targetVersion = status.updateInfo?.version ?? null
  const targetSize = status.updateInfo?.files.reduce((sum, file) => sum + (file.size ?? 0), 0) ?? 0
  const isSparkle = status.provider === 'sparkle'

  return (
    <SettingsPage
      title={labels.pageTitle}
      description={labels.pageDescription}
      action={desktop
        ? (
            <Badge variant="outline" className="gap-1.5 font-mono text-[11px]">
              <MonitorIcon className="size-3" aria-hidden="true" />
              {labels.desktopBadge}
            </Badge>
          )
        : undefined}
      data-testid="desktop-update-settings"
      data-settings-desktop-ready={statusReady ? 'true' : 'false'}
    >
      <SettingsGroup>
        <SettingsRow label={labels.doubleCommandQLabel} description={labels.doubleCommandQDescription}>
          <Switch
            checked={desktopPreferences?.requireDoubleCommandQToQuit ?? true}
            onCheckedChange={onSetRequireDoubleCommandQ}
            disabled={preferencesDisabled}
            aria-label={labels.doubleCommandQLabel}
            data-testid="desktop-double-command-q"
          />
        </SettingsRow>

        <SettingsRow label={labels.autoCheckLabel} description={labels.autoCheckDescription}>
          <Switch
            checked={desktopPreferences?.autoCheckForUpdates ?? true}
            onCheckedChange={onSetAutoCheck}
            disabled={preferencesDisabled}
            aria-label={labels.autoCheckLabel}
            data-testid="desktop-auto-check"
          />
        </SettingsRow>

        <SettingsRow
          label={labels.externalTerminalLabel}
          description={labels.externalTerminalDescription}
          vertical
        >
          <Input
            value={terminalApplication}
            onChange={event => setTerminalApplication(event.target.value)}
            onBlur={() => {
              const normalized = terminalApplication.trim()
              onSetExternalTerminal(normalized.length > 0 ? normalized : null)
            }}
            onKeyDown={event => event.key === 'Enter' && event.currentTarget.blur()}
            placeholder={labels.externalTerminalPlaceholder}
            disabled={preferencesDisabled}
            aria-label={labels.externalTerminalLabel}
            data-testid="desktop-external-terminal"
          />
        </SettingsRow>

        {desktop && preferredEditorSetting}
      </SettingsGroup>

      {desktop
        ? (
            <div className="flex flex-col gap-3">
              <DesktopOperationsCard
                title={labels.updatesTitle}
                testId="desktop-updates-card"
                badge={<Badge variant="outline" className="font-mono text-[11px]">{labels.updateStatus}</Badge>}
              >
                <div className="flex items-center justify-between gap-3 text-[12px]">
                  <span className="text-muted-foreground">{labels.currentVersion}</span>
                  <span className="font-mono tabular-nums text-foreground">{status.currentVersion}</span>
                </div>
                {updateDownload && (
                  <div className="flex items-center justify-between gap-3 text-[12px]">
                    <span className="text-muted-foreground">{labels.downloading}</span>
                    <span className="font-mono tabular-nums text-foreground">
                      {formatCompactBytes(updateDownload.transferredBytes)}
                      {updateDownload.totalBytes === null
                        ? ' · —'
                        : ` / ${formatCompactBytes(updateDownload.totalBytes)}`}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3 text-[12px]">
                  <span className="text-muted-foreground">{labels.availableVersion}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono tabular-nums text-foreground">
                      {targetVersion ?? labels.noUpdate}
                    </span>
                    {targetSize > 0 && (
                      <span className="text-[11px] text-muted-foreground">{formatCompactBytes(targetSize)}</span>
                    )}
                  </div>
                </div>

                {status.updateInfo?.releaseNotes && (
                  <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5">
                    <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">{labels.releaseNotes}</p>
                    <div className="max-h-48 overflow-y-auto text-[12px] [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-[12px] [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-[12px] [&_h3]:font-medium [&_h3]:text-foreground [&_p]:my-1 [&_p]:text-muted-foreground [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0.5 [&_li]:text-muted-foreground [&_blockquote]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground [&_blockquote]:italic [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[11px]">
                      <StaticRender content={status.updateInfo.releaseNotes} />
                    </div>
                  </div>
                )}

                {status.errorMessage && (
                  <p className="text-[11px] text-muted-foreground">{status.errorMessage}</p>
                )}
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onRefresh}
                    disabled={!capabilities.refreshUpdate}
                    aria-label={labels.refreshUpdate}
                  >
                    {loading
                      ? <Spinner className="size-3.5" />
                      : <RefreshCwIcon className="size-3.5" aria-hidden="true" />}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onCheckUpdate}
                    disabled={!capabilities.checkUpdate}
                  >
                    {status.isCheckingForUpdates
                      ? <Spinner className="size-3.5" />
                      : <PackageCheckIcon className="size-3.5" aria-hidden="true" />}
                    {labels.checkUpdate}
                  </Button>
                  {!isSparkle && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onDownloadUpdate}
                        disabled={!capabilities.downloadUpdate}
                      >
                        <DownloadIcon className="size-3.5" aria-hidden="true" />
                        {labels.downloadUpdate}
                      </Button>
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        onClick={onApplyUpdate}
                        disabled={!capabilities.applyUpdate}
                      >
                        <RefreshCwIcon className="size-3.5" aria-hidden="true" />
                        {labels.restart}
                      </Button>
                    </>
                  )}
                </div>
              </DesktopOperationsCard>

              <DesktopOperationsCard
                title={labels.cliTitle}
                testId="desktop-cli-card"
                badge={<Badge variant="outline" className="font-mono text-[11px]">{labels.cliStatus}</Badge>}
              >
                <div className="flex flex-col gap-1">
                  <span className="break-all font-mono text-[12px] tabular-nums text-foreground">
                    {cliStatus.commandPath}
                  </span>
                  {cliStatus.sourcePath && (
                    <span className="break-all font-mono text-[11px] text-muted-foreground">
                      {cliStatus.sourcePath}
                    </span>
                  )}
                  {cliStatus.errorMessage && (
                    <p className="text-[11px] text-muted-foreground">{cliStatus.errorMessage}</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onRefresh}
                    disabled={!capabilities.refreshCli}
                    aria-label={labels.refreshCli}
                  >
                    {loading
                      ? <Spinner className="size-3.5" />
                      : <RefreshCwIcon className="size-3.5" aria-hidden="true" />}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onRemoveCli}
                    disabled={!capabilities.removeCli}
                  >
                    <UnlinkIcon className="size-3.5" aria-hidden="true" />
                    {labels.removeCli}
                  </Button>
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={onInstallCli}
                    disabled={!capabilities.installCli}
                  >
                    <TerminalIcon className="size-3.5" aria-hidden="true" />
                    {cliStatus.installed ? labels.repairCli : labels.installCli}
                  </Button>
                </div>
              </DesktopOperationsCard>
            </div>
          )
        : (
            <p className="text-[12px] text-muted-foreground" data-testid="desktop-web-notice">
              {labels.webNotice}
            </p>
          )}
    </SettingsPage>
  )
}
