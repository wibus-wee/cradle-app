import type { Meta, StoryObj } from '@storybook/react-vite'

import { ChronicleAudioTranscriptCardView } from './chronicle-audio-transcript-card-view'
import { chronicleAudioTranscriptFixtures } from './fixtures/chronicle-audio'

const meta = {
  title: 'App/Chronicle/Audio Transcript Card',
  component: ChronicleAudioTranscriptCardView,
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
    transcript: chronicleAudioTranscriptFixtures[0],
  },
} satisfies Meta<typeof ChronicleAudioTranscriptCardView>

export default meta
type Story = StoryObj<typeof meta>

export const Completed: Story = {}

export const Recording: Story = {
  args: {
    transcript: chronicleAudioTranscriptFixtures[1],
  },
}

export const ImportedEmpty: Story = {
  args: {
    transcript: chronicleAudioTranscriptFixtures[2],
  },
}

export const Error: Story = {
  args: {
    transcript: chronicleAudioTranscriptFixtures[3],
  },
}
