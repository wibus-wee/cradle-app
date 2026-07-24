import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { productAnalyticsConfigured } from '~/features/product-analytics/client'
import { useProductAnalyticsStore } from '~/features/product-analytics/store'
import type { CradleDataPaths } from '~/lib/electron'
import { isElectron, nativeIpc } from '~/lib/electron'

import type { AboutExternalAccessRow } from './about-settings-view'
import { AboutSettingsView } from './about-settings-view'

type SettingsKey = keyof typeof import('~/locales/default').default.settings

const EXTERNAL_ACCESS_ROW_KEYS: Array<{
  kind: AboutExternalAccessRow['kind']
  labelKey: SettingsKey
  descriptionKey: SettingsKey
  pathKey: SettingsKey
}> = [
  {
    kind: 'folder',
    labelKey: 'about.external.workspace.label',
    descriptionKey: 'about.external.workspace.description',
    pathKey: 'about.external.workspace.path',
  },
  {
    kind: 'drive',
    labelKey: 'about.external.skills.label',
    descriptionKey: 'about.external.skills.description',
    pathKey: 'about.external.skills.path',
  },
  {
    kind: 'drive',
    labelKey: 'about.external.nativeSkillRoots.label',
    descriptionKey: 'about.external.nativeSkillRoots.description',
    pathKey: 'about.external.nativeSkillRoots.path',
  },
  {
    kind: 'bot',
    labelKey: 'about.external.claudeDir.label',
    descriptionKey: 'about.external.claudeDir.description',
    pathKey: 'about.external.claudeDir.path',
  },
  {
    kind: 'terminal',
    labelKey: 'about.external.cli.label',
    descriptionKey: 'about.external.cli.description',
    pathKey: 'about.external.cli.path',
  },
  {
    kind: 'bot',
    labelKey: 'about.external.agentActions.label',
    descriptionKey: 'about.external.agentActions.description',
    pathKey: 'about.external.agentActions.path',
  },
  {
    kind: 'key',
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
    <AboutSettingsView
      paths={paths}
      showAnalytics={productAnalyticsConfigured()}
      analyticsEnabled={analyticsEnabled}
      onAnalyticsEnabledChange={setAnalyticsEnabled}
      externalAccessRows={EXTERNAL_ACCESS_ROW_KEYS.map(row => ({
        kind: row.kind,
        label: t(row.labelKey),
        description: t(row.descriptionKey),
        path: t(row.pathKey),
      }))}
      labels={{
        pageTitle: t('about.page.title'),
        pageDescription: t('about.page.description'),
        noticeTitle: t('about.notice.title'),
        noticeDescription: t('about.notice.description'),
        applicationSupportLabel: t('about.storage.applicationSupport.label'),
        applicationSupportDescription: t('about.storage.applicationSupport.description'),
        applicationSupportFallback: t('about.storage.applicationSupport.fallback'),
        applicationSupportCustom: t('about.storage.applicationSupport.custom'),
        applicationSupportDefault: t('about.storage.applicationSupport.default'),
        databaseLabel: t('about.storage.database.label'),
        databaseDescription: t('about.storage.database.description'),
        databaseFallback: t('about.storage.database.fallback'),
        readOnlyLabel: t('about.readOnly.label'),
        readOnlyDescription: t('about.readOnly.description'),
        readOnlyValue: t('about.readOnly.value'),
        analyticsTitle: t('about.analytics.title'),
        analyticsDescription: t('about.analytics.description'),
        analyticsShareLabel: t('about.analytics.share.label'),
        analyticsShareDescription: t('about.analytics.share.description'),
        externalTitle: t('about.external.title'),
        externalDescription: t('about.external.description'),
      }}
    />
  )
}
