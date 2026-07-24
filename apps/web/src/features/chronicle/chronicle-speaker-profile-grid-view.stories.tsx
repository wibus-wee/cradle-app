import type { Meta, StoryObj } from '@storybook/react-vite'

import { ChronicleSpeakerProfileGridView } from './chronicle-speaker-profile-grid-view'
import { chronicleSpeakerProfileFixtures } from './fixtures/chronicle-memory-knowledge'

const meta = {
  title: 'App/Chronicle/Speaker Profiles',
  component: ChronicleSpeakerProfileGridView,
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
    profiles: chronicleSpeakerProfileFixtures,
  },
} satisfies Meta<typeof ChronicleSpeakerProfileGridView>

export default meta
type Story = StoryObj<typeof meta>

export const IdentifiedAndUnknown: Story = {}

export const Empty: Story = {
  args: {
    profiles: [],
  },
}

export const Loading: Story = {
  args: {
    loading: true,
    profiles: [],
  },
}
