import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import type { DesktopUpdateStatus } from '~/lib/electron'

import { SidebarUpdateButtonView } from './sidebar-update-button-view'

const availableStatus = {
  unsupported: false,
  provider: 'electron-updater',
  currentVersion: '1.8.2',
  isCheckingForUpdates: false,
  isPreparingUpdate: false,
  updateDownloaded: false,
  updateInfo: {
    version: '1.9.0',
    releaseName: 'Cradle 1.9.0',
    releaseNotes: '- Faster runtime recovery\n- Expanded Storybook coverage',
    releaseDate: '2026-07-24',
    files: [],
  },
  errorMessage: null,
} satisfies DesktopUpdateStatus

const meta = {
  title: 'Layout/SidebarUpdateButtonView',
  component: SidebarUpdateButtonView,
  decorators: [
    Story => (
      <aside className="w-64 bg-sidebar pt-3 text-sidebar-foreground">
        <Story />
      </aside>
    ),
  ],
  args: {
    collapsed: false,
    status: availableStatus,
    statusLabel: 'Version 1.9.0 is available',
    buttonLabel: 'Desktop update',
    tooltipTitle: 'Desktop update',
    availableLabel: 'Available: 1.9.0',
    isDownloading: false,
    onOpen: fn(),
  },
} satisfies Meta<typeof SidebarUpdateButtonView>

export default meta

type Story = StoryObj<typeof meta>

export const Available: Story = {}

export const Downloading: Story = {
  args: {
    statusLabel: 'Downloading update: 68%',
    isDownloading: true,
  },
}

export const Downloaded: Story = {
  args: {
    status: {
      ...availableStatus,
      updateDownloaded: true,
    },
    statusLabel: 'Ready to restart',
  },
}

export const Collapsed: Story = {
  decorators: [
    Story => (
      <aside className="w-12 bg-sidebar pt-3 text-sidebar-foreground">
        <Story />
      </aside>
    ),
  ],
  args: {
    collapsed: true,
  },
}
