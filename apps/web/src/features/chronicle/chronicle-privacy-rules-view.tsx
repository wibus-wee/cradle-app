import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Switch } from '~/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { SettingsRow } from '~/features/settings/settings-row'

import { ChroniclePrivacyRuleTextareaView } from './chronicle-privacy-rule-textarea-view'
import {
  areChroniclePrivacyRuleListsEqual,
  formatChroniclePrivacyRuleLines,
  parseChroniclePrivacyRuleLines,
} from './chronicle-privacy-rules-presenter'
import type { ChronicleConfig } from './use-chronicle'

interface ChroniclePrivacyRulesDraft {
  appBundleText: string
  titlePatternText: string
  urlPatternText: string
}

export interface ChroniclePrivacyRulesViewProps {
  config: ChronicleConfig | null
  saving: boolean
  onUpdateConfig: (updates: Partial<ChronicleConfig>) => Promise<ChronicleConfig | null>
}

export function ChroniclePrivacyRulesView({
  config,
  saving,
  onUpdateConfig,
}: ChroniclePrivacyRulesViewProps) {
  const { t } = useTranslation('chronicle')
  const [draft, setDraft] = useState<ChroniclePrivacyRulesDraft>({
    appBundleText: '',
    titlePatternText: '',
    urlPatternText: '',
  })
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    setDraft({
      appBundleText: formatChroniclePrivacyRuleLines(config?.privacySensitiveAppBundleIds ?? []),
      titlePatternText: formatChroniclePrivacyRuleLines(config?.privacySensitiveTitlePatterns ?? []),
      urlPatternText: formatChroniclePrivacyRuleLines(config?.privacySensitiveUrlPatterns ?? []),
    })
    setSaved(false)
  }, [
    config?.privacySensitiveAppBundleIds,
    config?.privacySensitiveTitlePatterns,
    config?.privacySensitiveUrlPatterns,
  ])

  const nextAppBundleIds = parseChroniclePrivacyRuleLines(draft.appBundleText)
  const nextTitlePatterns = parseChroniclePrivacyRuleLines(draft.titlePatternText)
  const nextUrlPatterns = parseChroniclePrivacyRuleLines(draft.urlPatternText)
  const ruleCount = nextAppBundleIds.length + nextTitlePatterns.length + nextUrlPatterns.length
  const hasChanges = config
    ? !areChroniclePrivacyRuleListsEqual(nextAppBundleIds, config.privacySensitiveAppBundleIds)
    || !areChroniclePrivacyRuleListsEqual(nextTitlePatterns, config.privacySensitiveTitlePatterns)
    || !areChroniclePrivacyRuleListsEqual(nextUrlPatterns, config.privacySensitiveUrlPatterns)
    : false

  const saveRules = () => {
    setSaveError(null)
    setSaved(false)
    void onUpdateConfig({
      privacySensitiveAppBundleIds: nextAppBundleIds,
      privacySensitiveTitlePatterns: nextTitlePatterns,
      privacySensitiveUrlPatterns: nextUrlPatterns,
    })
      .then((updated) => {
        if (updated) {
          setSaved(true)
        }
      })
      .catch((error: unknown) => {
        setSaveError(error instanceof Error ? error.message : t('common.error.saveFailed'))
      })
  }

  return (
    <div className="flex flex-col">
      <SettingsRow
        label={t('privacy.closedEyes.title')}
        description={t('privacy.closedEyes.description')}
        labelAccessory={(
          <Badge variant="outline" className="text-[11px]">
            {t('common.status.unavailable')}
          </Badge>
        )}
        vertical
      >
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            value="always-record"
            disabled
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem
              value="auto"
              aria-label={t('privacy.closedEyes.mode.auto.ariaLabel')}
              className="h-7 px-2 text-[11px]"
            >
              {t('privacy.closedEyes.mode.auto')}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="always-record"
              aria-label={t('privacy.closedEyes.mode.alwaysRecord.ariaLabel')}
              className="h-7 px-2 text-[11px]"
            >
              {t('privacy.closedEyes.mode.alwaysRecord')}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="always-pause"
              aria-label={t('privacy.closedEyes.mode.alwaysPause.ariaLabel')}
              className="h-7 px-2 text-[11px]"
            >
              {t('privacy.closedEyes.mode.alwaysPause')}
            </ToggleGroupItem>
          </ToggleGroup>
          <Switch
            aria-label={t('privacy.closedEyes.toggle')}
            checked={false}
            disabled
          />
        </div>
      </SettingsRow>
      <div className="border-t border-border/60" />

      <SettingsRow
        label={t('privacy.title')}
        description={t('privacy.help')}
        labelAccessory={(
          <Badge variant="outline" className="text-[11px]">
            {ruleCount === 0
              ? t('common.status.notConfigured')
              : t('privacy.ruleCount', { count: ruleCount })}
          </Badge>
        )}
        vertical
      >
        <div className="grid gap-3 lg:grid-cols-3">
          <ChroniclePrivacyRuleTextareaView
            label="App bundle id"
            placeholder={t('privacy.appBundle.placeholder')}
            value={draft.appBundleText}
            onChange={appBundleText => setDraft(current => ({ ...current, appBundleText }))}
            disabled={saving || !config}
          />
          <ChroniclePrivacyRuleTextareaView
            label={t('privacy.titlePattern.label')}
            placeholder={t('privacy.titlePattern.placeholder')}
            value={draft.titlePatternText}
            onChange={titlePatternText => setDraft(current => ({ ...current, titlePatternText }))}
            disabled={saving || !config}
          />
          <ChroniclePrivacyRuleTextareaView
            label={t('privacy.urlPattern.label')}
            placeholder={t('privacy.urlPattern.placeholder')}
            value={draft.urlPatternText}
            onChange={urlPatternText => setDraft(current => ({ ...current, urlPatternText }))}
            disabled={saving || !config}
          />
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          {saveError && (
            <span className="text-[12px] text-destructive">
              {saveError}
            </span>
          )}
          {!saveError && saved && (
            <span className="text-[12px] text-muted-foreground">
              {t('common.status.saved')}
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="sm:ml-auto"
            disabled={!config || saving || !hasChanges}
            onClick={saveRules}
          >
            {t('privacy.saveRules')}
          </Button>
        </div>
      </SettingsRow>
    </div>
  )
}
