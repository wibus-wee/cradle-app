import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { BUILT_IN_SHORTCUT_GROUPS } from '~/features/shortcuts/built-in-shortcuts'
import defaultSettings from '~/locales/default/settings'

import { ShortcutSettingsView } from './shortcut-settings-view'
import type { DesktopPreferences } from './use-desktop-preferences'

const desktopPreferences = {
  requireDoubleCommandQToQuit: true,
  appshotHotkeyEnabled: true,
  appshotHotkeyTrigger: 'DoubleCommand',
  autoCheckForUpdates: true,
  autoDownloadUpdates: false,
  lastSeenChangelogVersion: null,
  externalTerminalApp: null,
} satisfies DesktopPreferences

const labels = {
  pageTitle: defaultSettings['shortcut.page.title'],
  pageDescription: defaultSettings['shortcut.page.description'],
  desktopBadge: defaultSettings['shortcut.badge.desktop'],
  configurableTitle: defaultSettings['shortcut.configurable.title'],
  configurableDescription: defaultSettings['shortcut.configurable.description'],
  appshotLabel: defaultSettings['shortcut.appshotHotkey.label'],
  appshotDescription: defaultSettings['shortcut.appshotHotkey.description'],
  appshotTriggerLabel: defaultSettings['shortcut.appshotHotkey.triggerLabel'],
  appshotEnabledLabel: defaultSettings['shortcut.appshotHotkey.enabledLabel'],
  commandOption: defaultSettings['shortcut.appshotHotkey.option.command'],
  optionOption: defaultSettings['shortcut.appshotHotkey.option.option'],
  shiftOption: defaultSettings['shortcut.appshotHotkey.option.shift'],
  fileTitle: defaultSettings['shortcut.file.title'],
  fileDescription: defaultSettings['shortcut.file.description'],
  filePathLabel: defaultSettings['shortcut.file.pathLabel'],
  fileOpen: defaultSettings['shortcut.file.open'],
  loading: 'Loading...',
  webNotice: defaultSettings['shortcut.webNotice.description'],
}

const meta = {
  title: 'Settings/ShortcutSettingsView',
  component: ShortcutSettingsView,
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    desktop: true,
    desktopPreferences,
    preferencesDisabled: false,
    keybindingsConfigPath: '/Users/clarity/.config/cradle/keybindings.json',
    keybindingsErrors: [],
    builtInGroups: BUILT_IN_SHORTCUT_GROUPS,
    labelForShortcutKey: key => defaultSettings[key],
    labels,
    onChangeTrigger: fn(),
    onChangeEnabled: fn(),
    onOpenConfig: fn(),
  },
} satisfies Meta<typeof ShortcutSettingsView>

export default meta

type Story = StoryObj<typeof meta>

export const Desktop: Story = {}

export const DisabledHotkey: Story = {
  args: {
    desktopPreferences: {
      ...desktopPreferences,
      appshotHotkeyEnabled: false,
      appshotHotkeyTrigger: 'DoubleOption',
    },
  },
}

export const InvalidKeybindings: Story = {
  args: {
    keybindingsErrors: ['Line 12: command must be a registered command id'],
  },
}

export const Web: Story = {
  args: {
    desktop: false,
    desktopPreferences: null,
    keybindingsConfigPath: null,
  },
}
