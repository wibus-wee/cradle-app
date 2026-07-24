import type { Meta, StoryObj } from '@storybook/react-vite'

import { ChronicleAudioRawSegmentCardView } from './chronicle-audio-raw-segment-card-view'
import { chronicleAudioRawSegmentFixtures } from './fixtures/chronicle-audio'

const meta = {
  title: 'App/Chronicle/Raw Audio Segment Card',
  component: ChronicleAudioRawSegmentCardView,
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
    segment: chronicleAudioRawSegmentFixtures[0],
  },
} satisfies Meta<typeof ChronicleAudioRawSegmentCardView>

export default meta
type Story = StoryObj<typeof meta>

export const Active: Story = {}

export const Quiet: Story = {
  args: {
    segment: chronicleAudioRawSegmentFixtures[1],
  },
}

export const Error: Story = {
  args: {
    segment: chronicleAudioRawSegmentFixtures[2],
  },
}
