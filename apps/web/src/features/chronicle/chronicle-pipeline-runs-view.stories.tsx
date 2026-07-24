import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { ChroniclePipelineRunsView } from './chronicle-pipeline-runs-view'
import { chroniclePipelineRunFixtures } from './fixtures/chronicle-activity'

const meta = {
  title: 'App/Chronicle/Pipeline Runs',
  component: ChroniclePipelineRunsView,
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
    runs: chroniclePipelineRunFixtures,
    busy: false,
    onRunNow: fn(),
  },
} satisfies Meta<typeof ChroniclePipelineRunsView>

export default meta
type Story = StoryObj<typeof meta>

export const MixedStates: Story = {}

export const Empty: Story = {
  args: {
    runs: [],
  },
}

export const Busy: Story = {
  args: {
    busy: true,
  },
}

export const Error: Story = {
  args: {
    runs: chroniclePipelineRunFixtures.slice(2),
  },
}
