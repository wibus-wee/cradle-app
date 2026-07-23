import type { Meta, StoryObj } from '@storybook/react-vite'

import { BrowserChromeStatusView } from './browser-chrome-status-view'

const meta = {
  title: 'App/Browser/Chrome Status',
  component: BrowserChromeStatusView,
  decorators: [
    Story => (
      <main className="h-screen min-h-32 bg-background">
        <Story />
      </main>
    ),
  ],
  args: {
    status: {
      tone: 'default',
      label: 'Restoring tab...',
    },
  },
} satisfies Meta<typeof BrowserChromeStatusView>

export default meta
type Story = StoryObj<typeof meta>

export const Restoring: Story = {}

export const Starting: Story = {
  args: {
    status: {
      tone: 'default',
      label: 'Starting browser...',
    },
  },
}

export const NoTabs: Story = {
  args: {
    status: {
      tone: 'default',
      label: 'No tabs open',
    },
  },
}

export const Error: Story = {
  args: {
    status: {
      tone: 'error',
      label: 'The browser process stopped before the page could load.',
    },
  },
}
