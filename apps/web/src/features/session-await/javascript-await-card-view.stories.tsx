import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import type { JavaScriptAwaitCardViewProps } from './javascript-await-card-view'
import { JavaScriptAwaitCardView } from './javascript-await-card-view'

const program = `const res = await fetch('https://api.example.com/deploy/status')
const data = await res.json()
ctx.observe({ phase: data.phase, progress: data.progress })
return data.phase === 'live' ? ctx.resume('Deploy is live') : false`

const observation = {
  note: 'Deploy still rolling out',
  phase: 'rolling',
  progress: 0.62,
}

const now = Date.now()

const base: JavaScriptAwaitCardViewProps = {
  status: 'pending',
  title: 'Waiting for the deploy to finish',
  statusText: 'Waiting for the deploy to finish',
  hasError: false,
  program,
  observation,
  lastCheckedAt: now - 2 * 60_000,
  consecutiveErrors: 0,
  matchedText: null,
  previewErrorText: null,
  isRunning: false,
  onRunNow: fn(),
  onCancel: fn(),
}

const meta = {
  title: 'Features/SessionAwait/JavaScriptAwaitCardView',
  component: JavaScriptAwaitCardView,
  args: base,
  decorators: [
    Story => (
      <div className="w-[20rem] p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof JavaScriptAwaitCardView>

export default meta
type Story = StoryObj<typeof meta>

export const Pending: Story = {}

export const PendingFresh: Story = {
  args: {
    observation: undefined,
    lastCheckedAt: null,
    statusText: 'Waiting for the deploy to finish',
  },
}

export const PendingRunning: Story = {
  args: { isRunning: true },
}

export const MatchedPreview: Story = {
  args: {
    matchedText: 'Deploy is live',
    observation: { note: 'Deploy just went live', phase: 'live', progress: 1 },
  },
}

export const PreviewError: Story = {
  args: {
    previewErrorText: 'fetch failed: ENETUNREACH',
  },
}

export const Triggered: Story = {
  args: {
    status: 'triggered',
    statusText: 'Completed: condition matched',
    onRunNow: undefined,
    onCancel: undefined,
  },
}

export const Failed: Story = {
  args: {
    status: 'failed',
    hasError: true,
    statusText: 'Evaluation failed 3 times: Unexpected token < in JSON',
    consecutiveErrors: 3,
    onRunNow: undefined,
    onCancel: undefined,
  },
}

export const Cancelled: Story = {
  args: {
    status: 'cancelled',
    statusText: 'Cancelled',
    onRunNow: undefined,
    onCancel: undefined,
  },
}

export const LongProgram: Story = {
  args: {
    program: `${program}\n`.repeat(6),
  },
}
