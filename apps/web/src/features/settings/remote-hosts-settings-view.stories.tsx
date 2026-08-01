import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { Badge } from '~/components/ui/badge'

import {
  remoteHostsSettingsCopy,
  remoteHostsSettingsHosts,
} from './fixtures/remote-hosts-settings'
import { RemoteHostsSettingsView } from './remote-hosts-settings-view'

const meta = {
  title: 'Settings/RemoteHostsSettingsView',
  component: RemoteHostsSettingsView,
  parameters: { layout: 'fullscreen' },
  args: {
    copy: remoteHostsSettingsCopy,
    hosts: remoteHostsSettingsHosts,
    loading: false,
    guideOpen: false,
    revealHostId: null,
    onAddHost: fn(),
    onGuideOpenChange: fn(),
    renderHost: host => (
      <div key={host.id} className="flex items-center justify-between gap-4 px-3.5 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{host.displayName}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{host.id}</p>
        </div>
        <Badge variant="outline">{host.connectionState}</Badge>
      </div>
    ),
    hostEnrollmentsSlot: (
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        This computer is ready to accept relay pairings.
      </div>
    ),
    relayServersSlot: (
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        Built-in local relay · connected
      </div>
    ),
    pairComputerSlot: null,
  },
} satisfies Meta<typeof RemoteHostsSettingsView>

export default meta

type Story = StoryObj<typeof meta>

export const ConnectedAndOffline: Story = {}

export const Empty: Story = {
  args: { hosts: [] },
}

export const Loading: Story = {
  args: { hosts: [], loading: true },
}

export const GuideOpen: Story = {
  args: { guideOpen: true },
}
