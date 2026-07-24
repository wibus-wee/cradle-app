import { KeyboardLine as KeyboardIcon } from '@mingcute/react'

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
import type { BuiltInShortcutGroup } from '~/features/shortcuts/built-in-shortcuts'
import type { MacInputBareModifier } from '~/lib/electron'

import { SettingsGroup, SettingsPage } from './settings-container'
import type { SettingsKey } from './settings-key'
import { SettingsRow } from './settings-row'
import { ShortcutKeyList } from './shortcut-key-list'
import type { DesktopPreferences } from './use-desktop-preferences'

const APP_SHOT_HOTKEY_TRIGGERS: MacInputBareModifier[] = [
  'DoubleCommand',
  'DoubleOption',
  'DoubleShift',
]

function isAppshotHotkeyTrigger(value: string): value is MacInputBareModifier {
  return APP_SHOT_HOTKEY_TRIGGERS.includes(value as MacInputBareModifier)
}

interface ShortcutSettingsViewProps {
  desktop: boolean
  desktopPreferences: DesktopPreferences | null
  preferencesDisabled?: boolean
  keybindingsConfigPath?: string | null
  keybindingsErrors?: readonly string[]
  builtInGroups: readonly BuiltInShortcutGroup[]
  labelForShortcutKey: (key: SettingsKey) => string
  labels: {
    pageTitle: string
    pageDescription: string
    desktopBadge: string
    configurableTitle: string
    configurableDescription: string
    appshotLabel: string
    appshotDescription: string
    appshotTriggerLabel: string
    appshotEnabledLabel: string
    commandOption: string
    optionOption: string
    shiftOption: string
    fileTitle: string
    fileDescription: string
    filePathLabel: string
    fileOpen: string
    loading: string
    webNotice: string
  }
  onChangeTrigger: (trigger: MacInputBareModifier) => void
  onChangeEnabled: (enabled: boolean) => void
  onOpenConfig: () => void
}

export function ShortcutSettingsView({
  desktop,
  desktopPreferences,
  preferencesDisabled = false,
  keybindingsConfigPath,
  keybindingsErrors = [],
  builtInGroups,
  labelForShortcutKey,
  labels,
  onChangeTrigger,
  onChangeEnabled,
  onOpenConfig,
}: ShortcutSettingsViewProps) {
  const triggerLabels = {
    DoubleCommand: labels.commandOption,
    DoubleOption: labels.optionOption,
    DoubleShift: labels.shiftOption,
  } satisfies Record<MacInputBareModifier, string>

  return (
    <SettingsPage
      title={labels.pageTitle}
      description={labels.pageDescription}
      action={desktop
        ? (
            <Badge variant="outline" className="gap-1.5 font-mono text-[11px]">
              <KeyboardIcon className="size-3" aria-hidden="true" />
              {labels.desktopBadge}
            </Badge>
          )
        : undefined}
      data-testid="shortcut-settings"
    >
      <SettingsGroup label={labels.configurableTitle} description={labels.configurableDescription}>
        <SettingsRow label={labels.appshotLabel} description={labels.appshotDescription}>
          <div className="flex items-center gap-3">
            <Select
              value={desktopPreferences?.appshotHotkeyTrigger ?? 'DoubleCommand'}
              onValueChange={(value) => {
                if (isAppshotHotkeyTrigger(value)) {
                  onChangeTrigger(value)
                }
              }}
              disabled={preferencesDisabled}
            >
              <SelectTrigger
                size="sm"
                className="w-40"
                aria-label={labels.appshotTriggerLabel}
                data-testid="shortcut-appshot-hotkey-trigger"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {APP_SHOT_HOTKEY_TRIGGERS.map(trigger => (
                  <SelectItem key={trigger} value={trigger}>{triggerLabels[trigger]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Switch
              checked={desktopPreferences?.appshotHotkeyEnabled ?? true}
              onCheckedChange={onChangeEnabled}
              disabled={preferencesDisabled}
              aria-label={labels.appshotEnabledLabel}
              data-testid="shortcut-appshot-hotkey"
            />
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label={labels.fileTitle} description={labels.fileDescription}>
        <SettingsRow
          label={labels.filePathLabel}
          description={keybindingsErrors.join('; ') || undefined}
        >
          <div className="flex max-w-md items-center gap-2">
            <code className="min-w-0 truncate rounded-md bg-[var(--color-surface-inset)] px-2 py-1.5 font-mono text-[11px] text-[var(--text-secondary)] shadow-[var(--shadow-inset-ring)]">
              {keybindingsConfigPath ?? labels.loading}
            </code>
            {desktop && keybindingsConfigPath && (
              <Button type="button" variant="outline" size="sm" onClick={onOpenConfig}>
                {labels.fileOpen}
              </Button>
            )}
          </div>
        </SettingsRow>
      </SettingsGroup>

      {builtInGroups.map(group => (
        <SettingsGroup
          key={group.labelKey}
          label={labelForShortcutKey(group.labelKey)}
          description={labelForShortcutKey(group.descriptionKey)}
        >
          {group.items.map(item => (
            <SettingsRow
              key={item.labelKey}
              label={labelForShortcutKey(item.labelKey)}
              description={labelForShortcutKey(item.descriptionKey)}
            >
              <ShortcutKeyList keys={item.keys} />
            </SettingsRow>
          ))}
        </SettingsGroup>
      ))}

      {!desktop && (
        <p className="text-[12px] text-muted-foreground" data-testid="shortcut-web-notice">
          {labels.webNotice}
        </p>
      )}
    </SettingsPage>
  )
}
