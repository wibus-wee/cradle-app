import {
  DriveLine as HardDriveIcon,
  FolderLine as FolderIcon,
  Key2Line as KeyRoundIcon,
  RobotLine as BotIcon,
  SafeAlertLine as ShieldAlertIcon,
  TerminalLine as TerminalIcon,
} from '@mingcute/react'

import { Switch } from '~/components/ui/switch'
import type { CradleDataPaths } from '~/lib/electron'

import { AboutPathValue } from './about-path-value'
import { SettingsGroup, SettingsPage } from './settings-container'
import { SettingsRow } from './settings-row'

export interface AboutExternalAccessRow {
  kind: 'folder' | 'drive' | 'bot' | 'terminal' | 'key'
  label: string
  description: string
  path: string
}

interface AboutSettingsViewProps {
  paths: CradleDataPaths | null
  showAnalytics: boolean
  analyticsEnabled: boolean
  onAnalyticsEnabledChange: (enabled: boolean) => void
  externalAccessRows: readonly AboutExternalAccessRow[]
  labels: {
    pageTitle: string
    pageDescription: string
    noticeTitle: string
    noticeDescription: string
    applicationSupportLabel: string
    applicationSupportDescription: string
    applicationSupportFallback: string
    applicationSupportCustom: string
    applicationSupportDefault: string
    databaseLabel: string
    databaseDescription: string
    databaseFallback: string
    readOnlyLabel: string
    readOnlyDescription: string
    readOnlyValue: string
    analyticsTitle: string
    analyticsDescription: string
    analyticsShareLabel: string
    analyticsShareDescription: string
    externalTitle: string
    externalDescription: string
  }
}

const EXTERNAL_ACCESS_ICONS = {
  folder: FolderIcon,
  drive: HardDriveIcon,
  bot: BotIcon,
  terminal: TerminalIcon,
  key: KeyRoundIcon,
} as const

export function AboutSettingsView({
  paths,
  showAnalytics,
  analyticsEnabled,
  onAnalyticsEnabledChange,
  externalAccessRows,
  labels,
}: AboutSettingsViewProps) {
  return (
    <SettingsPage
      title={labels.pageTitle}
      description={labels.pageDescription}
      data-testid="about-settings"
      data-settings-about-ready="true"
    >
      <SettingsGroup bare className="flex items-start gap-3 p-4">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300">
          <ShieldAlertIcon className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h4 className="text-[13px] font-medium text-foreground">{labels.noticeTitle}</h4>
          <p className="mt-1 max-w-2xl text-pretty text-[12px] leading-5 text-muted-foreground">
            {labels.noticeDescription}
          </p>
        </div>
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow
          label={labels.applicationSupportLabel}
          description={labels.applicationSupportDescription}
        >
          <div className="flex max-w-[60%] flex-col items-end gap-0.5">
            <AboutPathValue value={paths?.serverDataPath ?? labels.applicationSupportFallback} />
            {paths && (
              <span className="text-[11px] text-muted-foreground">
                {paths.serverDataSource === 'custom'
                  ? labels.applicationSupportCustom
                  : labels.applicationSupportDefault}
              </span>
            )}
          </div>
        </SettingsRow>

        <SettingsRow label={labels.databaseLabel} description={labels.databaseDescription}>
          <AboutPathValue value={paths?.databasePath ?? labels.databaseFallback} />
        </SettingsRow>

        <SettingsRow label={labels.readOnlyLabel} description={labels.readOnlyDescription}>
          <span className="text-[12px] text-muted-foreground">{labels.readOnlyValue}</span>
        </SettingsRow>
      </SettingsGroup>

      {showAnalytics && (
        <SettingsGroup label={labels.analyticsTitle} description={labels.analyticsDescription}>
          <SettingsRow label={labels.analyticsShareLabel} description={labels.analyticsShareDescription}>
            <Switch
              size="sm"
              checked={analyticsEnabled}
              onCheckedChange={onAnalyticsEnabledChange}
              aria-label={labels.analyticsShareLabel}
              data-testid="product-analytics-enabled"
            />
          </SettingsRow>
        </SettingsGroup>
      )}

      <SettingsGroup
        label={labels.externalTitle}
        description={labels.externalDescription}
        bare
        className="p-4"
      >
        <div className="flex flex-col gap-2">
          {externalAccessRows.map((row) => {
            const Icon = EXTERNAL_ACCESS_ICONS[row.kind]
            return (
              <div key={`${row.kind}:${row.label}`} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3 gap-y-1 py-1">
                <Icon className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-foreground">{row.label}</div>
                  <div className="mt-0.5 text-[12px] leading-5 text-muted-foreground">{row.description}</div>
                  <div className="mt-1 break-all font-mono text-[11px] leading-4 text-muted-foreground/80">{row.path}</div>
                </div>
              </div>
            )
          })}
        </div>
      </SettingsGroup>
    </SettingsPage>
  )
}
