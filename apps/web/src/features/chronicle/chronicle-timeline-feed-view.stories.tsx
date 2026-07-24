import type { Meta, StoryObj } from '@storybook/react-vite'

import { ChronicleTimelineFeedView } from './chronicle-timeline-feed-view'
import { chronicleTimelineFixtures } from './fixtures/chronicle-timeline'

const meta = {
  title: 'App/Chronicle/Timeline Feed',
  component: ChronicleTimelineFeedView,
  decorators: [
    Story => (
      <main className="min-h-screen bg-muted/20 p-4">
        <div className="mx-auto max-w-6xl">
          <Story />
        </div>
      </main>
    ),
  ],
  args: {
    entries: chronicleTimelineFixtures,
    frameUrlForEntry: () => '/icon.png',
  },
} satisfies Meta<typeof ChronicleTimelineFeedView>

export default meta
type Story = StoryObj<typeof meta>

export const MixedSources: Story = {}

export const SingleDisplay: Story = {
  args: {
    entries: chronicleTimelineFixtures.filter(entry => entry.displayId === 1),
  },
}

export const ScreenRecords: Story = {
  args: {
    entries: chronicleTimelineFixtures.filter(entry => entry.sourceType === 'snapshot'),
  },
}

export const MessageAndAudio: Story = {
  args: {
    entries: chronicleTimelineFixtures.filter(entry => entry.sourceType !== 'snapshot'),
  },
}

export const Empty: Story = {
  args: {
    entries: [],
  },
}
