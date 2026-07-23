import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { unhealthyWorkDetailFixture, workDetailFixture } from './fixtures/work-detail'
import { WorkAsidePanelView } from './work-aside-panel-view'

const labels = {
  objective: 'Objective',
  objectiveEmpty: 'No objective provided.',
  execution: 'Execution',
  executionUnhealthy: 'The managed worktree needs repair.',
  tryAgain: 'Try again',
  managedWorktree: 'Managed worktree',
  changes: 'Changes',
  clean: 'Clean',
  changedFiles: '12 changed files',
  commits: 'Commits',
  commitsAhead: '3 commits ahead',
  reviewChanges: 'Review changes',
  handoff: 'Handoff',
  handoffTestPlan: 'Test plan',
  handoffEmpty: 'The agent has not prepared a handoff yet.',
}

const meta = {
  title: 'Work/WorkAsidePanelView',
  component: WorkAsidePanelView,
  decorators: [
    Story => (
      <aside className="flex h-[36rem] w-full max-w-[22rem] border-r border-border bg-background">
        <Story />
      </aside>
    ),
  ],
  args: {
    detail: workDetailFixture,
    labels,
    canReviewChanges: true,
    isReviewingChanges: false,
    isRepairing: false,
    onReviewChanges: fn(),
    onRepair: fn(),
  },
} satisfies Meta<typeof WorkAsidePanelView>

export default meta

type Story = StoryObj<typeof meta>

export const Healthy: Story = {}

export const UnhealthyWorktree: Story = {
  args: {
    detail: unhealthyWorkDetailFixture,
    labels: {
      ...labels,
      commitsAhead: '0 commits ahead',
    },
  },
}

export const Repairing: Story = {
  args: {
    detail: unhealthyWorkDetailFixture,
    isRepairing: true,
  },
}

export const Loading: Story = {
  args: {
    detail: null,
  },
}
