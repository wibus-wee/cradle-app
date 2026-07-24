import type { Meta, StoryObj } from '@storybook/react-vite'

import { ChronicleAudioTranscriptListView } from './chronicle-audio-transcript-list-view'
import { chronicleAudioTranscriptFixtures } from './fixtures/chronicle-audio'

const meta = {
  title: 'App/Chronicle/Audio Transcripts',
  component: ChronicleAudioTranscriptListView,
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
    transcripts: chronicleAudioTranscriptFixtures,
  },
} satisfies Meta<typeof ChronicleAudioTranscriptListView>

export default meta
type Story = StoryObj<typeof meta>

export const MixedStates: Story = {}

export const Empty: Story = {
  args: {
    transcripts: [],
  },
}

export const Loading: Story = {
  args: {
    loading: true,
    transcripts: [],
  },
}
