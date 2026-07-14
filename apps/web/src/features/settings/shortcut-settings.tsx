import { KeyboardLine as KeyboardIcon } from '@mingcute/react'
import { useQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Switch } from '~/components/ui/switch'
import { keybindingsQueryOptions } from '~/features/shortcuts/api/keybindings'
import { BUILT_IN_SHORTCUT_GROUPS } from '~/features/shortcuts/built-in-shortcuts'
import type { MacInputBareModifier } from '~/lib/electron'
import { isElectron, nativeIpc } from '~/lib/electron'

import { SettingsGroup, SettingsPage } from './settings-container'
import type { SettingsKey } from './settings-key'
import { SettingsRow } from './settings-row'
import type { DesktopPreferences } from './use-desktop-preferences'
import { useDesktopPreferences } from './use-desktop-preferences'

const APP_SHOT_HOTKEY_TRIGGERS: MacInputBareModifier[] = [
  'DoubleCommand',
  'DoubleOption',
  'DoubleShift',
]

const APP_SHOT_HOTKEY_LABEL_KEYS = {
  DoubleCommand: 'shortcut.appshotHotkey.option.command',
  DoubleOption: 'shortcut.appshotHotkey.option.option',
  DoubleShift: 'shortcut.appshotHotkey.option.shift',
} satisfies Record<MacInputBareModifier, SettingsKey>

function isAppshotHotkeyTrigger(value: string): value is MacInputBareModifier {
  return APP_SHOT_HOTKEY_TRIGGERS.includes(value as MacInputBareModifier)
}

function ShortcutKeyList({ keys }: { keys: readonly string[] }) {
  return (
    <div className="flex max-w-[18rem] flex-wrap justify-end gap-1.5">
      {keys.map(key => (
        <kbd
          key={key}
          className="inline-flex h-6 items-center rounded-md border border-border bg-muted px-1.5 font-mono text-[11px] leading-none text-foreground"
        >
          {key}
        </kbd>
      ))}
    </div>
  )
}

export function ShortcutSettings() {
  const { t } = useTranslation('settings')
  const {
    prefs: desktopPrefs,
    isSaving: isSavingDesktopPrefs,
    savePrefs: saveDesktopPrefs,
  } = useDesktopPreferences()
  const keybindingsQuery = useQuery(keybindingsQueryOptions())

  const savePreference = useCallback(
    (updates: Partial<DesktopPreferences>) => {
      void saveDesktopPrefs(updates).then((updated) => {
        if (updated && isElectron && nativeIpc) {
          void nativeIpc.native.setDesktopPreferences(updated).catch(() => {})
        }
      })
    },
    [saveDesktopPrefs],
  )

  const prefsDisabled = !desktopPrefs || isSavingDesktopPrefs
  const selectedTrigger = desktopPrefs?.appshotHotkeyTrigger ?? 'DoubleCommand'
  const desktopIpc = isElectron ? nativeIpc : null
  const keybindingsConfigPath = keybindingsQuery.data?.configPath

  return (
    <SettingsPage
      title={t('shortcut.page.title' as SettingsKey)}
      description={t('shortcut.page.description' as SettingsKey)}
      action={
        isElectron
? (
          <Badge variant="outline" className="gap-1.5 font-mono text-[11px]">
            <KeyboardIcon className="size-3" aria-hidden="true" />
            {t('shortcut.badge.desktop' as SettingsKey)}
          </Badge>
        )
: undefined
      }
      data-testid="shortcut-settings"
    >
      <SettingsGroup
        label={t('shortcut.configurable.title' as SettingsKey)}
        description={t('shortcut.configurable.description' as SettingsKey)}
      >
        <SettingsRow
          label={t('shortcut.appshotHotkey.label' as SettingsKey)}
          description={t('shortcut.appshotHotkey.description' as SettingsKey)}
        >
          <div className="flex items-center gap-3">
            <Select
              value={selectedTrigger}
              onValueChange={(value) => {
                if (isAppshotHotkeyTrigger(value)) {
                  savePreference({ appshotHotkeyTrigger: value })
                }
              }}
              disabled={prefsDisabled}
            >
              <SelectTrigger
                size="sm"
                className="w-40"
                aria-label={t('shortcut.appshotHotkey.triggerLabel' as SettingsKey)}
                data-testid="shortcut-appshot-hotkey-trigger"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {APP_SHOT_HOTKEY_TRIGGERS.map(trigger => (
                  <SelectItem key={trigger} value={trigger}>
                    {t(APP_SHOT_HOTKEY_LABEL_KEYS[trigger])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Switch
              checked={desktopPrefs?.appshotHotkeyEnabled ?? true}
              onCheckedChange={appshotHotkeyEnabled => savePreference({ appshotHotkeyEnabled })}
              disabled={prefsDisabled}
              aria-label={t('shortcut.appshotHotkey.enabledLabel' as SettingsKey)}
              data-testid="shortcut-appshot-hotkey"
            />
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        label={t('shortcut.file.title' as SettingsKey)}
        description={t('shortcut.file.description' as SettingsKey)}
      >
        <SettingsRow
          label={t('shortcut.file.pathLabel' as SettingsKey)}
          description={keybindingsQuery.data?.errors.join('; ') || undefined}
        >
          <div className="flex max-w-md items-center gap-2">
            <code className="min-w-0 truncate rounded-md bg-[var(--color-surface-inset)] px-2 py-1.5 font-mono text-[11px] text-[var(--text-secondary)] shadow-[var(--shadow-inset-ring)]">
              {keybindingsConfigPath ?? 'Loading…'}
            </code>
            {desktopIpc && keybindingsConfigPath && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void desktopIpc.native.openPath(keybindingsConfigPath)}
              >
                {t('shortcut.file.open' as SettingsKey)}
              </Button>
            )}
          </div>
        </SettingsRow>
      </SettingsGroup>

      {BUILT_IN_SHORTCUT_GROUPS.map(group => (
        <SettingsGroup
          key={group.labelKey}
          label={t(group.labelKey)}
          description={t(group.descriptionKey)}
        >
          {group.items.map(item => (
            <SettingsRow
              key={item.labelKey}
              label={t(item.labelKey)}
              description={t(item.descriptionKey)}
            >
              <ShortcutKeyList keys={item.keys} />
            </SettingsRow>
          ))}
        </SettingsGroup>
      ))}

      {!isElectron && (
        <p className="text-[12px] text-muted-foreground" data-testid="shortcut-web-notice">
          {t('shortcut.webNotice.description' as SettingsKey)}
        </p>
      )}
    </SettingsPage>
  )
}
