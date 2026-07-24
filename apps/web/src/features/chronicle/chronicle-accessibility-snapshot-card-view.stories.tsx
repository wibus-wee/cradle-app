import type { Meta, StoryObj } from '@storybook/react-vite'

import { ChronicleAccessibilitySnapshotCardView } from './chronicle-accessibility-snapshot-card-view'
import { chronicleAccessibilitySnapshotFixtures } from './fixtures/chronicle-accessibility'

const meta = {
  title: 'App/Chronicle/Accessibility Snapshot Card',
  component: ChronicleAccessibilitySnapshotCardView,
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
    snapshot: chronicleAccessibilitySnapshotFixtures[0],
  },
} satisfies Meta<typeof ChronicleAccessibilitySnapshotCardView>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {}

export const PermissionDenied: Story = {
  args: {
    snapshot: chronicleAccessibilitySnapshotFixtures[1],
  },
}

export const Error: Story = {
  args: {
    snapshot: chronicleAccessibilitySnapshotFixtures[2],
  },
}
