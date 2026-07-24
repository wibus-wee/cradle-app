import type { Meta, StoryObj } from '@storybook/react-vite'

import { ChronicleAccessibilitySnapshotListView } from './chronicle-accessibility-snapshot-list-view'
import { chronicleAccessibilitySnapshotFixtures } from './fixtures/chronicle-accessibility'

const meta = {
  title: 'App/Chronicle/Accessibility Snapshots',
  component: ChronicleAccessibilitySnapshotListView,
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
    snapshots: chronicleAccessibilitySnapshotFixtures,
  },
} satisfies Meta<typeof ChronicleAccessibilitySnapshotListView>

export default meta
type Story = StoryObj<typeof meta>

export const MixedStates: Story = {}

export const ReadyWithTree: Story = {
  args: {
    snapshots: [chronicleAccessibilitySnapshotFixtures[0]],
  },
}

export const Empty: Story = {
  args: {
    snapshots: [],
  },
}

export const Loading: Story = {
  args: {
    loading: true,
    snapshots: [],
  },
}
