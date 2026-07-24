import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import type { SessionPullRequest } from '~/features/session/api/pull-request'

import { workDetailFixture } from './fixtures/work-detail'
import { WorkHeaderChromeView } from './work-header-chrome-view'

const pullRequest = workDetailFixture.pullRequest satisfies SessionPullRequest

const meta = {
  title: 'Work/WorkHeaderChromeView',
  component: WorkHeaderChromeView,
  decorators: [
    Story => (
      <div className="flex min-h-20 items-center justify-end bg-sidebar p-4">
        <Story />
      </div>
    ),
  ],
  args: {
    pullRequest: null,
    pullRequestStatusLabel: null,
    showPublish: true,
    canSubmit: true,
    blockedReason: null,
    submitLabel: 'Create Draft PR',
    markReadyLabel: 'Mark ready',
    markingReadyLabel: 'Marking ready...',
    isSubmitting: false,
    isMarkingReady: false,
    onSubmit: fn(),
    onMarkReady: fn(),
    onOpenPullRequest: fn(),
  },
} satisfies Meta<typeof WorkHeaderChromeView>

export default meta

type Story = StoryObj<typeof meta>

export const CreateDraft: Story = {}

export const Publishing: Story = {
  args: {
    isSubmitting: true,
  },
}

export const BlockedByChanges: Story = {
  args: {
    canSubmit: false,
    blockedReason: 'Commit or discard worktree changes before publishing.',
  },
}

export const UpdateDraft: Story = {
  args: {
    pullRequest,
    pullRequestStatusLabel: 'Draft',
    submitLabel: 'Update Draft',
  },
}

export const DraftPublished: Story = {
  args: {
    pullRequest,
    pullRequestStatusLabel: 'Draft',
    showPublish: false,
  },
}

export const ReadyForReview: Story = {
  args: {
    pullRequest: {
      ...pullRequest,
      isDraft: false,
    },
    pullRequestStatusLabel: 'Ready',
    showPublish: false,
  },
}

export const Merged: Story = {
  args: {
    pullRequest: {
      ...pullRequest,
      isDraft: false,
      state: 'closed',
      merged: true,
    },
    pullRequestStatusLabel: 'Merged',
    showPublish: false,
  },
}
