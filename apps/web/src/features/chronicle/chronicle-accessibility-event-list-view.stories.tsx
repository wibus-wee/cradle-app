import type { Meta, StoryObj } from '@storybook/react-vite'

import { ChronicleAccessibilityEventListView } from './chronicle-accessibility-event-list-view'
import { chronicleAccessibilityEventFixtures } from './fixtures/chronicle-accessibility'

const meta = {
  title: 'App/Chronicle/Accessibility Events',
  component: ChronicleAccessibilityEventListView,
  decorators: [
    Story => (
      <main className="min-h-screen bg-muted/20 p-4">
        <div className="mx-auto max-w-5xl">
          <Story />
        </div>
      </main>
    ),
  ],
  args: {
    loading: false,
    events: chronicleAccessibilityEventFixtures,
  },
} satisfies Meta<typeof ChronicleAccessibilityEventListView>

export default meta
type Story = StoryObj<typeof meta>

export const MixedEvents: Story = {}

export const Empty: Story = {
  args: {
    events: [],
  },
}

export const Loading: Story = {
  args: {
    loading: true,
    events: [],
  },
}
