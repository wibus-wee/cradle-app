import type { Meta, StoryObj } from '@storybook/react-vite'

import { ChronicleAccessibilityEventCardView } from './chronicle-accessibility-event-card-view'
import { chronicleAccessibilityEventFixtures } from './fixtures/chronicle-accessibility'

const meta = {
  title: 'App/Chronicle/Accessibility Event Card',
  component: ChronicleAccessibilityEventCardView,
  decorators: [
    Story => (
      <main className="min-h-screen bg-muted/20 p-4">
        <div className="mx-auto max-w-xl">
          <Story />
        </div>
      </main>
    ),
  ],
  args: {
    event: chronicleAccessibilityEventFixtures[0],
  },
} satisfies Meta<typeof ChronicleAccessibilityEventCardView>

export default meta
type Story = StoryObj<typeof meta>

export const Captured: Story = {}

export const DroppedEvents: Story = {
  args: {
    event: chronicleAccessibilityEventFixtures[1],
  },
}

export const UnknownApplication: Story = {
  args: {
    event: chronicleAccessibilityEventFixtures[2],
  },
}
