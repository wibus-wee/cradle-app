import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { ChronicleActivityPipelineView } from './chronicle-activity-pipeline-view'
import {
  chronicleActivitySegmentFixtures,
  chroniclePipelineRunFixtures,
} from './fixtures/chronicle-activity'

const meta = {
  title: 'App/Chronicle/Activity Pipeline',
  component: ChronicleActivityPipelineView,
  decorators: [
    Story => (
      <main className="min-h-screen bg-muted/20 p-4">
        <div className="mx-auto max-w-7xl">
          <Story />
        </div>
      </main>
    ),
  ],
  args: {
    segments: chronicleActivitySegmentFixtures,
    runs: chroniclePipelineRunFixtures,
    busy: false,
    onTriageSegment: fn(),
    onSummarizeSegment: fn(),
    onCrystallizeSegment: fn(),
    onRunNow: fn(),
  },
} satisfies Meta<typeof ChronicleActivityPipelineView>

export default meta
type Story = StoryObj<typeof meta>

export const MixedPipelineStates: Story = {}

export const Busy: Story = {
  args: {
    busy: true,
  },
}

export const EmptyRuns: Story = {
  args: {
    runs: [],
  },
}

export const SingleSegment: Story = {
  args: {
    segments: chronicleActivitySegmentFixtures.slice(0, 1),
    runs: chroniclePipelineRunFixtures.slice(0, 1),
  },
}
