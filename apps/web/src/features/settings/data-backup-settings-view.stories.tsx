import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import defaultSettings from '~/locales/default/settings'

import type { DataBackupSettingsViewCopy } from './data-backup-settings-view'
import { DataBackupSettingsView } from './data-backup-settings-view'

const copy = {
  title: defaultSettings['backup.page.title'],
  description: defaultSettings['backup.page.description'],
  badge: defaultSettings['backup.badge.local'],
  noticeTitle: defaultSettings['backup.notice.title'],
  noticeDescription: defaultSettings['backup.notice.description'],
  exportLabel: defaultSettings['backup.export.label'],
  exportDescription: defaultSettings['backup.export.description'],
  exportAction: defaultSettings['backup.export.action'],
  restoreLabel: defaultSettings['backup.restore.label'],
  restoreDescription: defaultSettings['backup.restore.description'],
  restoreAction: defaultSettings['backup.restore.action'],
  unavailable: defaultSettings['backup.unavailable'],
  confirmTitle: defaultSettings['backup.restore.confirmTitle'],
  confirmDescription: defaultSettings['backup.restore.confirmDescription'].replace(
    '{{path}}',
    '/Users/clarity/Documents/Cradle Backup.cradle-backup',
  ),
  confirmCancel: defaultSettings['backup.restore.cancel'],
  confirmAction: defaultSettings['backup.restore.confirm'],
} satisfies DataBackupSettingsViewCopy

const meta = {
  title: 'Settings/DataBackupSettingsView',
  component: DataBackupSettingsView,
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    copy,
    available: true,
    busy: false,
    statusMessage: null,
    statusTone: 'neutral',
    pendingRestorePath: null,
    onExport: fn(),
    onChooseRestore: fn(),
    onCancelRestore: fn(),
    onConfirmRestore: fn(),
  },
} satisfies Meta<typeof DataBackupSettingsView>

export default meta

type Story = StoryObj<typeof meta>

export const Ready: Story = {}

export const Exported: Story = {
  args: {
    statusMessage: 'Backup exported successfully to /Users/clarity/Documents/Cradle Backup.cradle-backup.',
  },
}

export const ConfirmRestore: Story = {
  args: {
    pendingRestorePath: '/Users/clarity/Documents/Cradle Backup.cradle-backup',
  },
}

export const Failed: Story = {
  args: {
    statusMessage: 'Backup operation failed: The backup failed checksum verification.',
    statusTone: 'error',
  },
}
