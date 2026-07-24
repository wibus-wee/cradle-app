import type { Meta, StoryObj } from '@storybook/react-vite'

import { ChronicleAudioRawSegmentListView } from './chronicle-audio-raw-segment-list-view'
import { chronicleAudioRawSegmentFixtures } from './fixtures/chronicle-audio'

const meta = {
  title: 'App/Chronicle/Raw Audio Segments',
  component: ChronicleAudioRawSegmentListView,
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
    segments: chronicleAudioRawSegmentFixtures,
  },
} satisfies Meta<typeof ChronicleAudioRawSegmentListView>

export default meta
type Story = StoryObj<typeof meta>

export const ProcessingStates: Story = {}

export const Empty: Story = {
  args: {
    segments: [],
  },
}

export const Loading: Story = {
  args: {
    loading: true,
    segments: [],
  },
}
