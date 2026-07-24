import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { BrowserNewTabSurfaceView } from './browser-new-tab-surface-view'
import type { BrowserLocalServer } from './use-local-servers'

const localServers = [
  {
    url: 'http://localhost:5174',
    title: 'Cradle Web',
    port: 5174,
    statusCode: 200,
  },
  {
    url: 'http://localhost:6006',
    title: 'Storybook',
    port: 6006,
    statusCode: 302,
  },
  {
    url: 'http://localhost:21423',
    title: 'Cradle Server',
    port: 21423,
    statusCode: null,
  },
] satisfies BrowserLocalServer[]

const meta = {
  title: 'App/Browser/New Tab Surface',
  component: BrowserNewTabSurfaceView,
  decorators: [
    Story => (
      <main className="relative h-screen min-h-96 overflow-hidden bg-background">
        <Story />
      </main>
    ),
  ],
  args: {
    localServers,
    localServersLoading: false,
    localServersError: null,
    onOpenUrl: fn(),
    onRefreshLocalServers: fn(),
  },
} satisfies Meta<typeof BrowserNewTabSurfaceView>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {}

export const Refreshing: Story = {
  args: {
    localServersLoading: true,
  },
}

export const Scanning: Story = {
  args: {
    localServers: [],
    localServersLoading: true,
  },
}

export const Empty: Story = {
  args: {
    localServers: [],
  },
}

export const Error: Story = {
  args: {
    localServers: [],
    localServersError: 'Local server discovery is unavailable.',
  },
}
