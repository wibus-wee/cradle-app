import type { Meta, StoryObj } from '@storybook/react-vite'

import { ChronicleTimelineRecordItemView } from './chronicle-timeline-record-item-view'
import { chronicleTimelineFixtures } from './fixtures/chronicle-timeline'

const meta = {
  title: 'App/Chronicle/Timeline Record Item',
  component: ChronicleTimelineRecordItemView,
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
    entry: chronicleTimelineFixtures[0],
    frameUrl: '/icon.png',
  },
} satisfies Meta<typeof ChronicleTimelineRecordItemView>

export default meta
type Story = StoryObj<typeof meta>

export const ScreenRecord: Story = {}

export const Message: Story = {
  args: {
    entry: chronicleTimelineFixtures[1],
  },
}

export const Audio: Story = {
  args: {
    entry: chronicleTimelineFixtures[2],
  },
}

export const MissingFrame: Story = {
  args: {
    entry: chronicleTimelineFixtures[3],
  },
}
