import {
  DriveLine as HardDriveIcon,
  FolderLine as FolderIcon,
  Key2Line as KeyRoundIcon,
  RobotLine as BotIcon,
  SafeAlertLine as ShieldAlertIcon,
  TerminalLine as TerminalIcon,
} from '@mingcute/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Switch } from '~/components/ui/switch'
import { useProductAnalyticsStore } from '~/features/product-analytics/store'
import { isElectron, nativeIpc } from '~/lib/electron'

import { SettingsGroup, SettingsPage } from './settings-container'
import { SettingsRow } from './settings-row'

type SettingsKey = keyof typeof import('~/locales/default').default.settings

interface CradleDataPaths {
  userDataPath: string
  serverDataPath: string
  databasePath: string
  serverLogPath: string
  serverDataSource: 'default' | 'custom'
  migration: { phase: string, sourceRoot: string | null, targetRoot: string | null, backupRoot: string | null, errorMessage: string | null }
}

const EXTERNAL_ACCESS_ROWS: Array<{
  icon: typeof FolderIcon
  labelKey: SettingsKey
  descriptionKey: SettingsKey
  pathKey: SettingsKey
}> = [
  {
    icon: FolderIcon,
    labelKey: 'about.external.workspace.label',
    descriptionKey: 'about.external.workspace.description',
    pathKey: 'about.external.workspace.path',
  },
  {
    icon: HardDriveIcon,
    labelKey: 'about.external.skills.label',
    descriptionKey: 'about.external.skills.description',
    pathKey: 'about.external.skills.path',
  },
  {
    icon: HardDriveIcon,
    labelKey: 'about.external.nativeSkillRoots.label',
    descriptionKey: 'about.external.nativeSkillRoots.description',
    pathKey: 'about.external.nativeSkillRoots.path',
  },
  {
    icon: BotIcon,
    labelKey: 'about.external.claudeDir.label',
    descriptionKey: 'about.external.claudeDir.description',
    pathKey: 'about.external.claudeDir.path',
  },
  {
    icon: TerminalIcon,
    labelKey: 'about.external.cli.label',
    descriptionKey: 'about.external.cli.description',
    pathKey: 'about.external.cli.path',
  },
  {
    icon: BotIcon,
    labelKey: 'about.external.agentActions.label',
    descriptionKey: 'about.external.agentActions.description',
    pathKey: 'about.external.agentActions.path',
  },
  {
    icon: KeyRoundIcon,
    labelKey: 'about.external.githubCliAuth.label',
    descriptionKey: 'about.external.githubCliAuth.description',
    pathKey: 'about.external.githubCliAuth.path',
  },
]

export function AboutSettings() {
  const { t } = useTranslation('settings')
  const [paths, setPaths] = useState<CradleDataPaths | null>(null)
  const analyticsEnabled = useProductAnalyticsStore(state => state.enabled)
  const setAnalyticsEnabled = useProductAnalyticsStore(state => state.setEnabled)

  useEffect(() => {
    if (!isElectron || !nativeIpc) {
      return
    }

    let cancelled = false
    void nativeIpc.native.getCradleDataPaths().then((nextPaths) => {
      if (!cancelled) {
        setPaths(nextPaths)
      }
    }).catch(() => {
      if (!cancelled) {
        setPaths(null)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <SettingsPage
      title={t('about.page.title')}
      description={t('about.page.description')}
      // action={<Badge variant="outline" className="font-mono text-[11px]">{t('about.badge.local')}</Badge>}
      data-testid="about-settings"
      data-settings-about-ready="true"
    >
      <SettingsGroup bare className="flex items-start gap-3 p-4">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300">
          <ShieldAlertIcon className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h4 className="text-[13px] font-medium text-foreground">{t('about.notice.title')}</h4>
          <p className="mt-1 max-w-2xl text-[12px] leading-5 text-muted-foreground text-pretty">
            {t('about.notice.description')}
          </p>
        </div>
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow
          label={t('about.storage.applicationSupport.label')}
          description={t('about.storage.applicationSupport.description')}
        >
          <div className="flex max-w-[60%] flex-col items-end gap-0.5">
            <PathValue value={paths?.serverDataPath ?? t('about.storage.applicationSupport.fallback')} />
            {paths && <span className="text-[11px] text-muted-foreground">{t(paths.serverDataSource === 'custom' ? 'about.storage.applicationSupport.custom' : 'about.storage.applicationSupport.default')}</span>}
          </div>
        </SettingsRow>

        <SettingsRow
          label={t('about.storage.database.label')}
          description={t('about.storage.database.description')}
        >
          <PathValue value={paths?.databasePath ?? t('about.storage.database.fallback')} />
        </SettingsRow>

        <SettingsRow
          label={t('about.readOnly.label')}
          description={t('about.readOnly.description')}
        >
          <span className="text-[12px] text-muted-foreground">{t('about.readOnly.value')}</span>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        label={t('about.analytics.title')}
        description={t('about.analytics.description')}
      >
        <SettingsRow
          label={t('about.analytics.share.label')}
          description={t('about.analytics.share.description')}
        >
          <Switch
            size="sm"
            checked={analyticsEnabled}
            onCheckedChange={setAnalyticsEnabled}
            aria-label={t('about.analytics.share.label')}
            data-testid="product-analytics-enabled"
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        label={t('about.external.title')}
        description={t('about.external.description')}
        bare
        className="p-4"
      >
        <div className="flex flex-col gap-2">
          {EXTERNAL_ACCESS_ROWS.map(({ icon: Icon, labelKey, descriptionKey, pathKey }) => (
            <div key={labelKey} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3 gap-y-1 py-1">
              <Icon className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-foreground">{t(labelKey)}</div>
                <div className="mt-0.5 text-[12px] leading-5 text-muted-foreground">{t(descriptionKey)}</div>
                <div className="mt-1 font-mono text-[11px] leading-4 text-muted-foreground/80 break-all">{t(pathKey)}</div>
              </div>
            </div>
          ))}
        </div>
      </SettingsGroup>
    </SettingsPage>
  )
}

function PathValue({ value }: { value: string }) {
  return (
    <span className="block max-w-80 break-all text-right font-mono text-[11px] leading-4 text-muted-foreground">
      {value}
    </span>
  )
}
