import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { ChronicleActivitySegmentCardView } from './chronicle-activity-segment-card-view'
import { chronicleActivitySegmentFixtures } from './fixtures/chronicle-activity'

const meta = {
  title: 'App/Chronicle/Activity Segment Card',
  component: ChronicleActivitySegmentCardView,
  decorators: [
    Story => (
      <main className="min-h-screen bg-muted/20 p-4">
        <div className="mx-auto max-w-2xl">
          <Story />
        </div>
      </main>
    ),
  ],
  args: {
    segment: chronicleActivitySegmentFixtures[0],
    busy: false,
    onTriage: fn(),
    onSummarize: fn(),
    onCrystallize: fn(),
  },
} satisfies Meta<typeof ChronicleActivitySegmentCardView>

export default meta
type Story = StoryObj<typeof meta>

export const Triaged: Story = {}

export const Summarized: Story = {
  args: {
    segment: chronicleActivitySegmentFixtures[1],
  },
}

export const Collecting: Story = {
  args: {
    segment: chronicleActivitySegmentFixtures[2],
  },
}

export const Busy: Story = {
  args: {
    busy: true,
  },
}

export const Crystallized: Story = {
  args: {
    segment: {
      ...chronicleActivitySegmentFixtures[0],
      id: 'segment-crystallized',
      pipelineStatus: 'crystallized',
      isCrystallized: true,
    },
  },
}
