import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { activeDownloadTask } from '~/features/download-center/fixtures/download-tasks'
import type { DesktopCliStatus, DesktopUpdateStatus } from '~/lib/electron'
import defaultSettings from '~/locales/default/settings'

import { DesktopUpdateSettingsView } from './desktop-update-settings-view'
import { SettingsRow } from './settings-row'
import type { DesktopPreferences } from './use-desktop-preferences'

const status = {
  unsupported: false,
  provider: 'electron-updater',
  currentVersion: '1.8.2',
  isCheckingForUpdates: false,
  isPreparingUpdate: false,
  updateDownloaded: false,
  updateInfo: {
    version: '1.9.0',
    releaseName: 'Cradle 1.9.0',
    releaseNotes: '## What changed\n\n- Faster runtime recovery\n- Fixture-driven Work and settings views',
    releaseDate: '2026-07-24',
    files: [
      {
        url: 'https://updates.example.com/cradle-1.9.0.dmg',
        size: 182_000_000,
        sha512: 'storybook',
      },
    ],
  },
  errorMessage: null,
} satisfies DesktopUpdateStatus

const cliStatus = {
  supported: true,
  installed: true,
  linked: true,
  requiresRepair: false,
  commandPath: '/usr/local/bin/cradle',
  sourcePath: '/Applications/Cradle.app/Contents/Resources/bin/cradle',
  errorMessage: null,
} satisfies DesktopCliStatus

const desktopPreferences = {
  requireDoubleCommandQToQuit: true,
  appshotHotkeyEnabled: true,
  appshotHotkeyTrigger: 'DoubleCommand',
  autoCheckForUpdates: true,
  autoDownloadUpdates: false,
  lastSeenChangelogVersion: null,
  externalTerminalApp: 'Ghostty.app',
} satisfies DesktopPreferences

const labels = {
  pageTitle: defaultSettings['desktop.page.title'],
  pageDescription: defaultSettings['desktop.page.description'],
  desktopBadge: defaultSettings['desktop.badge.desktop'],
  doubleCommandQLabel: defaultSettings['desktop.doubleCommandQ.label'],
  doubleCommandQDescription: defaultSettings['desktop.doubleCommandQ.description'],
  autoCheckLabel: defaultSettings['desktop.autoCheckForUpdates.label'],
  autoCheckDescription: defaultSettings['desktop.autoCheckForUpdates.description'],
  externalTerminalLabel: defaultSettings['desktop.externalTerminal.label'],
  externalTerminalDescription: defaultSettings['desktop.externalTerminal.description'],
  externalTerminalPlaceholder: defaultSettings['desktop.externalTerminal.placeholder'],
  updatesTitle: defaultSettings['desktop.updates.title'],
  updateStatus: defaultSettings['desktop.updates.status.available'],
  currentVersion: defaultSettings['desktop.updates.currentVersion'],
  downloading: defaultSettings['desktop.updates.status.downloading'],
  availableVersion: defaultSettings['desktop.updates.availableVersion'],
  noUpdate: defaultSettings['desktop.updates.none'],
  releaseNotes: defaultSettings['desktop.updates.releaseNotes'],
  refreshUpdate: defaultSettings['desktop.updates.actions.refresh'],
  checkUpdate: defaultSettings['desktop.updates.actions.check'],
  downloadUpdate: defaultSettings['desktop.updates.actions.download'],
  restart: defaultSettings['desktop.updates.actions.restart'],
  cliTitle: defaultSettings['desktop.cli.title'],
  cliStatus: defaultSettings['desktop.cli.status.installed'],
  refreshCli: defaultSettings['desktop.cli.actions.refresh'],
  removeCli: defaultSettings['desktop.cli.actions.remove'],
  repairCli: defaultSettings['desktop.cli.actions.repair'],
  installCli: defaultSettings['desktop.cli.actions.install'],
  webNotice: defaultSettings['desktop.webNotice.description'],
}

const capabilities = {
  refreshUpdate: true,
  checkUpdate: true,
  downloadUpdate: true,
  applyUpdate: false,
  refreshCli: true,
  removeCli: true,
  installCli: true,
}

const preferredEditorSetting = (
  <SettingsRow label="Preferred editor" description="Used when opening files from Cradle.">
    <Select defaultValue="code">
      <SelectTrigger size="sm" className="w-40" aria-label="Preferred editor">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="code">Visual Studio Code</SelectItem>
        <SelectItem value="zed">Zed</SelectItem>
      </SelectContent>
    </Select>
  </SettingsRow>
)

const meta = {
  title: 'Settings/DesktopUpdateSettingsView',
  component: DesktopUpdateSettingsView,
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    desktop: true,
    statusReady: true,
    status,
    cliStatus,
    updateDownload: null,
    desktopPreferences,
    preferencesDisabled: false,
    loading: false,
    preferredEditorSetting,
    capabilities,
    labels,
    onSetRequireDoubleCommandQ: fn(),
    onSetAutoCheck: fn(),
    onSetExternalTerminal: fn(),
    onRefresh: fn(),
    onCheckUpdate: fn(),
    onDownloadUpdate: fn(),
    onApplyUpdate: fn(),
    onRemoveCli: fn(),
    onInstallCli: fn(),
  },
} satisfies Meta<typeof DesktopUpdateSettingsView>

export default meta

type Story = StoryObj<typeof meta>

export const UpdateAvailable: Story = {}

export const Downloading: Story = {
  args: {
    updateDownload: {
      ...activeDownloadTask,
      scope: 'desktop',
      owner: {
        namespace: 'desktop-update',
        resourceType: 'macos-update',
        resourceId: '1.9.0',
        displayName: 'Cradle 1.9.0',
      },
    },
    labels: {
      ...labels,
      updateStatus: defaultSettings['desktop.updates.status.downloading'],
    },
    capabilities: {
      ...capabilities,
      checkUpdate: false,
      downloadUpdate: false,
    },
  },
}

export const Downloaded: Story = {
  args: {
    status: {
      ...status,
      updateDownloaded: true,
    },
    labels: {
      ...labels,
      updateStatus: defaultSettings['desktop.updates.status.ready'],
    },
    capabilities: {
      ...capabilities,
      downloadUpdate: false,
      applyUpdate: true,
    },
  },
}

export const CliRepair: Story = {
  args: {
    cliStatus: {
      ...cliStatus,
      installed: false,
      linked: false,
      requiresRepair: true,
      errorMessage: 'The command target no longer exists.',
    },
    labels: {
      ...labels,
      cliStatus: defaultSettings['desktop.cli.status.repair'],
    },
    capabilities: {
      ...capabilities,
      removeCli: false,
    },
  },
}

export const Web: Story = {
  args: {
    desktop: false,
    statusReady: true,
    status: {
      ...status,
      unsupported: true,
      provider: null,
      updateInfo: null,
    },
    desktopPreferences: null,
    preferredEditorSetting: null,
  },
}
