import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { BrowserPanelCreateSurfaceView } from './browser-panel-create-surface-view'

const meta = {
  title: 'App/Browser/Create Surface',
  component: BrowserPanelCreateSurfaceView,
  decorators: [
    Story => (
      <main className="relative h-screen min-h-96 overflow-hidden bg-background">
        <Story />
      </main>
    ),
  ],
  args: {
    canCreateTui: true,
    browserPending: false,
    onCreateBrowser: fn(),
    onCreateTui: fn(),
  },
} satisfies Meta<typeof BrowserPanelCreateSurfaceView>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {}

export const BrowserPending: Story = {
  args: {
    browserPending: true,
  },
}

export const WithoutWorkspace: Story = {
  args: {
    canCreateTui: false,
  },
}
