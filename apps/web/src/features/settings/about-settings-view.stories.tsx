import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import type { CradleDataPaths } from '~/lib/electron'

import { AboutSettingsView } from './about-settings-view'

const paths = {
  userDataPath: '/Users/clarity/Library/Application Support/Cradle',
  serverDataPath: '/Users/clarity/.cradle',
  databasePath: '/Users/clarity/.cradle/cradle.db',
  serverLogPath: '/Users/clarity/.cradle/server.log',
  serverDataSource: 'default',
  migration: {
    phase: 'idle',
    sourceRoot: null,
    targetRoot: null,
    backupRoot: null,
    errorMessage: null,
  },
} satisfies CradleDataPaths

const labels = {
  pageTitle: 'About',
  pageDescription: 'Local data, privacy, and external access conventions.',
  noticeTitle: 'Your data stays under your control',
  noticeDescription: 'Cradle stores operational data locally and exposes explicit paths for tools that need access.',
  applicationSupportLabel: 'Application support',
  applicationSupportDescription: 'Root directory for server-owned data.',
  applicationSupportFallback: 'Available in the desktop app',
  applicationSupportCustom: 'Custom location',
  applicationSupportDefault: 'Default location',
  databaseLabel: 'Database',
  databaseDescription: 'Primary local application database.',
  databaseFallback: 'Available in the desktop app',
  readOnlyLabel: 'External access',
  readOnlyDescription: 'Other tools should treat Cradle-owned data as read-only.',
  readOnlyValue: 'Read only',
  analyticsTitle: 'Product analytics',
  analyticsDescription: 'Anonymous events that help improve product workflows.',
  analyticsShareLabel: 'Share anonymous usage',
  analyticsShareDescription: 'No chat content, file content, or credentials are collected.',
  externalTitle: 'External tools',
  externalDescription: 'Supported paths and ownership rules for external integrations.',
}

const externalAccessRows = [
  {
    kind: 'folder' as const,
    label: 'Workspaces',
    description: 'Projects imported into Cradle remain owned by their original location.',
    path: '/path/to/your/workspace',
  },
  {
    kind: 'drive' as const,
    label: 'Agent skills',
    description: 'Cradle reads external skill roots without taking ownership of them.',
    path: '~/.agents/skills',
  },
  {
    kind: 'terminal' as const,
    label: 'CLI',
    description: 'Use the generated CLI for Cradle-owned workflows.',
    path: '/usr/local/bin/cradle',
  },
  {
    kind: 'key' as const,
    label: 'GitHub authentication',
    description: 'GitHub access uses the existing gh CLI authentication.',
    path: '~/.config/gh',
  },
]

const meta = {
  title: 'Settings/AboutSettingsView',
  component: AboutSettingsView,
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    paths,
    showAnalytics: true,
    analyticsEnabled: true,
    onAnalyticsEnabledChange: fn(),
    externalAccessRows,
    labels,
  },
} satisfies Meta<typeof AboutSettingsView>

export default meta

type Story = StoryObj<typeof meta>

export const Desktop: Story = {}

export const CustomDataDirectory: Story = {
  args: {
    paths: {
      ...paths,
      serverDataPath: '/Volumes/Engineering/Cradle',
      databasePath: '/Volumes/Engineering/Cradle/cradle.db',
      serverDataSource: 'custom',
    },
  },
}

export const WebFallback: Story = {
  args: {
    paths: null,
    showAnalytics: false,
  },
}

export const AnalyticsDisabled: Story = {
  args: {
    analyticsEnabled: false,
  },
}
