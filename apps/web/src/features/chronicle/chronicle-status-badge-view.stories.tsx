import type { Meta, StoryObj } from '@storybook/react-vite'

import { ChronicleStatusBadgeView } from './chronicle-status-badge-view'

const meta = {
  title: 'App/Chronicle/Status Badge',
  component: ChronicleStatusBadgeView,
  decorators: [
    Story => (
      <main className="min-h-screen bg-muted/20 p-4">
        <Story />
      </main>
    ),
  ],
  args: {
    running: true,
    available: true,
  },
} satisfies Meta<typeof ChronicleStatusBadgeView>

export default meta
type Story = StoryObj<typeof meta>

export const Running: Story = {}

export const Ready: Story = {
  args: {
    running: false,
  },
}

export const NotConfigured: Story = {
  args: {
    running: false,
    available: false,
  },
}
