import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { workDetailFixture } from '~/features/work/fixtures/work-detail'

import type { SessionPullRequest } from './api/pull-request'
import { SessionPullRequestChromeView } from './session-pull-request-chrome-view'

const pullRequest = workDetailFixture.pullRequest satisfies SessionPullRequest

const meta = {
  title: 'Session/SessionPullRequestChromeView',
  component: SessionPullRequestChromeView,
  decorators: [
    Story => (
      <div className="flex min-h-20 items-center bg-sidebar p-4">
        <Story />
      </div>
    ),
  ],
  args: {
    pullRequest,
    statusLabel: 'Draft',
    markReadyLabel: 'Mark ready',
    markingReadyLabel: 'Marking ready...',
    isMarkingReady: false,
    onOpenPullRequest: fn(),
    onMarkReady: fn(),
  },
} satisfies Meta<typeof SessionPullRequestChromeView>

export default meta

type Story = StoryObj<typeof meta>

export const Draft: Story = {}

export const MarkingReady: Story = {
  args: {
    isMarkingReady: true,
  },
}

export const Ready: Story = {
  args: {
    pullRequest: {
      ...pullRequest,
      isDraft: false,
    },
    statusLabel: 'Ready',
  },
}

export const Closed: Story = {
  args: {
    pullRequest: {
      ...pullRequest,
      isDraft: false,
      state: 'closed',
    },
    statusLabel: 'Closed',
  },
}
