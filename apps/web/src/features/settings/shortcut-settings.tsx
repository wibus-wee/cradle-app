import { useQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { keybindingsQueryOptions } from '~/features/shortcuts/api/keybindings'
import { BUILT_IN_SHORTCUT_GROUPS } from '~/features/shortcuts/built-in-shortcuts'
import type { MacInputBareModifier } from '~/lib/electron'
import { isElectron, nativeIpc } from '~/lib/electron'

import type { SettingsKey } from './settings-key'
import { ShortcutSettingsView } from './shortcut-settings-view'
import type { DesktopPreferences } from './use-desktop-preferences'
import { useDesktopPreferences } from './use-desktop-preferences'

export function ShortcutSettings() {
  const { t } = useTranslation('settings')
  const {
    prefs: desktopPreferences,
    isSaving: isSavingDesktopPreferences,
    savePrefs: saveDesktopPreferences,
  } = useDesktopPreferences()
  const keybindingsQuery = useQuery(keybindingsQueryOptions())

  const savePreference = useCallback(
    (updates: Partial<DesktopPreferences>) => {
      void saveDesktopPreferences(updates).then((updated) => {
        if (updated && isElectron && nativeIpc) {
          void nativeIpc.native.setDesktopPreferences(updated).catch(() => {})
        }
      })
    },
    [saveDesktopPreferences],
  )

  const keybindingsConfigPath = keybindingsQuery.data?.configPath ?? null

  return (
    <ShortcutSettingsView
      desktop={isElectron}
      desktopPreferences={desktopPreferences}
      preferencesDisabled={!desktopPreferences || isSavingDesktopPreferences}
      keybindingsConfigPath={keybindingsConfigPath}
      keybindingsErrors={keybindingsQuery.data?.errors}
      builtInGroups={BUILT_IN_SHORTCUT_GROUPS}
      labelForShortcutKey={key => t(key)}
      labels={{
        pageTitle: t('shortcut.page.title' as SettingsKey),
        pageDescription: t('shortcut.page.description' as SettingsKey),
        desktopBadge: t('shortcut.badge.desktop' as SettingsKey),
        configurableTitle: t('shortcut.configurable.title' as SettingsKey),
        configurableDescription: t('shortcut.configurable.description' as SettingsKey),
        appshotLabel: t('shortcut.appshotHotkey.label' as SettingsKey),
        appshotDescription: t('shortcut.appshotHotkey.description' as SettingsKey),
        appshotTriggerLabel: t('shortcut.appshotHotkey.triggerLabel' as SettingsKey),
        appshotEnabledLabel: t('shortcut.appshotHotkey.enabledLabel' as SettingsKey),
        commandOption: t('shortcut.appshotHotkey.option.command' as SettingsKey),
        optionOption: t('shortcut.appshotHotkey.option.option' as SettingsKey),
        shiftOption: t('shortcut.appshotHotkey.option.shift' as SettingsKey),
        fileTitle: t('shortcut.file.title' as SettingsKey),
        fileDescription: t('shortcut.file.description' as SettingsKey),
        filePathLabel: t('shortcut.file.pathLabel' as SettingsKey),
        fileOpen: t('shortcut.file.open' as SettingsKey),
        loading: 'Loading…',
        webNotice: t('shortcut.webNotice.description' as SettingsKey),
      }}
      onChangeTrigger={(appshotHotkeyTrigger: MacInputBareModifier) => {
        savePreference({ appshotHotkeyTrigger })
      }}
      onChangeEnabled={(appshotHotkeyEnabled) => {
        savePreference({ appshotHotkeyEnabled })
      }}
      onOpenConfig={() => {
        if (nativeIpc && keybindingsConfigPath) {
          void nativeIpc.native.openPath(keybindingsConfigPath)
        }
      }}
    />
  )
}
