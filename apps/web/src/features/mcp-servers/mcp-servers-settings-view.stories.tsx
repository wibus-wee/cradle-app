import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { mcpSettingsServers, registryCandidates } from './fixtures/mcp-servers'
import { McpServersSettingsView } from './mcp-servers-settings-view'
import { RegistryBrowserView } from './registry-browser'

const meta = {
  title: 'Settings/McpServersSettingsView',
  component: McpServersSettingsView,
  parameters: { layout: 'fullscreen' },
  args: {
    mode: 'installed',
    servers: mcpSettingsServers,
    isLoading: false,
    isError: false,
    toggling: false,
    discover: null,
    onModeChange: fn(),
    onRetry: fn(),
    onAdd: fn(),
    onToggle: fn(),
    onEdit: fn(),
    onDelete: fn(),
  },
} satisfies Meta<typeof McpServersSettingsView>

export default meta

type Story = StoryObj<typeof meta>

export const Populated: Story = {}

export const Loading: Story = {
  args: { servers: [], isLoading: true },
}

export const ErrorState: Story = {
  args: { servers: [], isError: true },
}

export const Empty: Story = {
  args: { servers: [] },
}

export const Discover: Story = {
  args: {
    mode: 'discover',
    discover: (
      <RegistryBrowserView
        search=""
        candidates={registryCandidates}
        isLoading={false}
        isError={false}
        hasNextPage
        isFetchingNextPage={false}
        onSearchChange={fn()}
        onRetry={fn()}
        onLoadMore={fn()}
        onInstall={fn()}
      />
    ),
  },
}
