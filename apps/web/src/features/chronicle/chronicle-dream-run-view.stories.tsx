import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { ChronicleDreamRunView } from './chronicle-dream-run-view'
import { chronicleDreamRunFixtures } from './fixtures/chronicle-dream-runs'

const meta = {
  title: 'App/Chronicle/Dream Runs',
  component: ChronicleDreamRunView,
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
    runs: chronicleDreamRunFixtures,
    busy: false,
    onGeneratePreview: fn(),
    onApplyMerge: fn(),
  },
} satisfies Meta<typeof ChronicleDreamRunView>

export default meta
type Story = StoryObj<typeof meta>

export const MixedStates: Story = {}

export const Busy: Story = {
  args: {
    busy: true,
  },
}

export const Empty: Story = {
  args: {
    runs: [],
  },
}

export const Loading: Story = {
  args: {
    loading: true,
    runs: [],
  },
}
