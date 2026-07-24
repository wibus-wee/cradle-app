import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { AgentSidebarRowView } from './agent-sidebar-row-view'
import {
  claudeCliAgentFixture,
  codexAgentFixture,
  providerTargetFixtures,
} from './fixtures/agents'

const meta = {
  title: 'Agent Management/AgentSidebarRowView',
  component: AgentSidebarRowView,
  decorators: [
    Story => (
      <aside className="w-72 bg-sidebar p-2 text-sidebar-foreground">
        <Story />
      </aside>
    ),
  ],
  args: {
    agent: codexAgentFixture,
    providerTargets: providerTargetFixtures,
    runtimeCatalog: [],
    active: false,
    selected: false,
    onClick: fn(),
    onToggleSelected: fn(),
  },
} satisfies Meta<typeof AgentSidebarRowView>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Active: Story = {
  args: {
    active: true,
  },
}

export const Selected: Story = {
  args: {
    selected: true,
  },
}

export const DisabledCli: Story = {
  args: {
    agent: claudeCliAgentFixture,
  },
}
