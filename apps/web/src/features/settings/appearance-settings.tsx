import { CheckLine as CheckIcon } from '@mingcute/react'
import { startTransition, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import {
  SESSION_PREVIEW_LIMIT_OPTIONS,
  useWorkspaceSidebarUiStore,
} from '~/features/workspace/workspace-sidebar-ui-store'
import { useI18n } from '~/i18n/i18n-context'
import type { SupportedLocale } from '~/i18n/locales'
import { localeOptions, normalizeLocale } from '~/i18n/locales'
import { cn } from '~/lib/cn'
import type { ThemeMode } from '~/store/theme'
import { useThemeStore } from '~/store/theme'
import { selectActiveThemeProfile, useThemeCustomizationStore } from '~/store/theme-customization'

import { SettingsGroup, SettingsPage } from './settings-container'
import { SettingsRow } from './settings-row'
import { ThemeCustomizationSettings } from './theme-customization-settings'
import { SystemThemePreview, ThemePreview } from './theme-preview'

type SettingsKey = keyof typeof import('~/locales/default').default.settings

const THEME_OPTIONS: Array<{ value: ThemeMode, labelKey: SettingsKey }> = [
  { value: 'light', labelKey: 'appearance.theme.light' },
  { value: 'dark', labelKey: 'appearance.theme.dark' },
  { value: 'system', labelKey: 'appearance.theme.system' },
]

const LOCALE_LABEL_KEYS = {
  'en-US': 'appearance.language.option.en-US',
  'zh-CN': 'appearance.language.option.zh-CN',
  'ja-JP': 'appearance.language.option.ja-JP',
  'es-ES': 'appearance.language.option.es-ES',
} as const satisfies Record<SupportedLocale, SettingsKey>

export function AppearanceSettings() {
  const { t } = useTranslation('settings')
  const mode = useThemeStore(s => s.mode)
  const setMode = useThemeStore(s => s.setMode)
  const lightProfile = useThemeCustomizationStore(state => selectActiveThemeProfile(state, 'light'))
  const darkProfile = useThemeCustomizationStore(state => selectActiveThemeProfile(state, 'dark'))
  const settingsAppearanceReady = THEME_OPTIONS.length > 0

  return (
    <SettingsPage
      title={t('appearance.page.title')}
      description={t('appearance.page.description')}
      maxWidth="4xl"
      data-testid="appearance-settings"
      data-settings-appearance-ready={settingsAppearanceReady ? 'true' : 'false'}
    >
      <SettingsGroup label={t('appearance.theme.label')} description={t('appearance.theme.description')}>
        <SettingsRow
          label={t('appearance.theme.mode')}
          info={t('appearance.theme.info')}
          vertical
        >
          <div className="flex gap-3">
            {THEME_OPTIONS.map(({ value, labelKey }) => {
              const selected = mode === value
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  data-testid={`appearance-theme-${value}`}
                  data-theme-selected={selected ? 'true' : 'false'}
                  className="group flex flex-col items-center gap-1.5"
                >
                  <div
                    className={cn(
                      'relative aspect-4/3 w-36 overflow-hidden rounded-lg p-0.5 transition-[box-shadow,outline-color] duration-150',
                      selected
                        ? 'ring-1 ring-foreground/30 ring-offset-2 ring-offset-background'
                        : 'ring-1 ring-border/60 hover:ring-border',
                    )}
                  >
                    {value === 'system'
                      ? <SystemThemePreview light={lightProfile} dark={darkProfile} />
                      : <ThemePreview profile={value === 'light' ? lightProfile : darkProfile} />}

                    {selected && (
                      <div className="absolute right-1 bottom-1 flex size-3.5 items-center justify-center rounded-full bg-foreground text-background">
                        <CheckIcon className="size-2" aria-hidden="true" />
                      </div>
                    )}
                  </div>
                  <span
                    className={cn(
                      'text-[11px]',
                      selected ? 'text-foreground font-medium' : 'text-muted-foreground',
                    )}
                  >
                    {t(labelKey)}
                  </span>
                </button>
              )
            })}
          </div>
        </SettingsRow>
      </SettingsGroup>

      <ThemeCustomizationSettings />

      <SettingsGroup label={t('appearance.general.title')}>
        <LanguageSettings />
        <SessionPreviewSettings />
      </SettingsGroup>
    </SettingsPage>
  )
}

function SessionPreviewSettings() {
  const { t } = useTranslation('settings')
  const sessionPreviewLimit = useWorkspaceSidebarUiStore(s => s.sessionPreviewLimit)
  const setSessionPreviewLimit = useWorkspaceSidebarUiStore(s => s.setSessionPreviewLimit)

  return (
    <SettingsRow
      label={t('appearance.sessionPreview.label')}
      description={t('appearance.sessionPreview.description')}
      info={t('appearance.sessionPreview.info')}
    >
      <Select
        value={String(sessionPreviewLimit)}
        onValueChange={value => setSessionPreviewLimit(Number(value))}
      >
        <SelectTrigger
          size="sm"
          className="w-28"
          aria-label={t('appearance.sessionPreview.label')}
          data-testid="appearance-session-preview-limit"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SESSION_PREVIEW_LIMIT_OPTIONS.map(option => (
            <SelectItem key={option} value={String(option)}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsRow>
  )
}

function LanguageSettings() {
  const { t } = useTranslation('settings')
  const { i18n, switchLang } = useI18n()
  const [activeLocale, setActiveLocale] = useState<SupportedLocale>(() => normalizeLocale(i18n.language))
  const [pendingLocale, setPendingLocale] = useState<SupportedLocale | null>(null)

  useEffect(() => {
    const syncLocale = (locale: string): void => {
      setActiveLocale(normalizeLocale(locale))
    }

    i18n.on('languageChanged', syncLocale)
    return () => {
      i18n.off('languageChanged', syncLocale)
    }
  }, [i18n])

  function selectLocale(locale: SupportedLocale): void {
    if (pendingLocale || locale === activeLocale) {
      return
    }

    setPendingLocale(locale)
    startTransition(() => {
      void switchLang(locale).finally(() => {
        setPendingLocale(null)
      })
    })
  }

  return (
    <SettingsRow
      label={t('appearance.language.label')}
      description={pendingLocale ? t('appearance.language.pending') : t('appearance.language.description')}
    >
      <div className="flex gap-1 rounded-lg border border-border p-0.5">
        {localeOptions.map((option) => {
          const selected = activeLocale === option.value
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => selectLocale(option.value)}
              aria-pressed={selected}
              disabled={pendingLocale !== null}
              className={cn(
                'h-7 rounded-md px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                selected ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(LOCALE_LABEL_KEYS[option.value])}
            </button>
          )
        })}
      </div>
    </SettingsRow>
  )
}
