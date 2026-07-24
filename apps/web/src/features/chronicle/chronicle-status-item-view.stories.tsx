import { ClockLine as ClockIcon } from '@mingcute/react'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { ChronicleStatusItemView } from './chronicle-status-item-view'

const meta = {
  title: 'App/Chronicle/Status Item',
  component: ChronicleStatusItemView,
  decorators: [
    Story => (
      <main className="min-h-screen bg-muted/20 p-4">
        <div className="w-48">
          <Story />
        </div>
      </main>
    ),
  ],
  args: {
    icon: <ClockIcon className="size-3.5" />,
    label: 'Last memory',
    value: '2 minutes ago',
    detail: '7/23/2026, 7:38:20 PM',
  },
} satisfies Meta<typeof ChronicleStatusItemView>

export default meta
type Story = StoryObj<typeof meta>

export const WithDetail: Story = {}

export const Count: Story = {
  args: {
    label: 'Memories',
    value: '46',
    detail: undefined,
  },
}
