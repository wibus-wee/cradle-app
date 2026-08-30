import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  pullRequestDetailFixture,
  pullRequestFixtureNow,
} from './fixtures/pull-requests'
import { PullRequestDetailPanelView } from './pull-request-detail-panel-view'

const actionsFixture = {
  pullRequest: pullRequestDetailFixture.pullRequest,
  assignableUsers: [
    { login: 'review-owner', avatarUrl: '/icon.png' },
    { login: 'cradle-maintainer', avatarUrl: '/icon.png' },
  ],
  pending: {
    comment: false,
    review: false,
    merge: false,
    readyDraft: false,
    assignees: false,
    reviewers: false,
  },
  onComment: () => {},
  onReview: () => {},
  onMerge: () => {},
  onToggleReadyDraft: () => {},
  onAddAssignee: () => {},
  onRemoveAssignee: () => {},
  onAddReviewer: () => {},
  onRemoveReviewer: () => {},
}

const meta = {
  title: 'App/Pull Requests/Detail',
  component: PullRequestDetailPanelView,
  decorators: [
    Story => (
      <main className="relative h-screen min-h-150 overflow-hidden bg-background">
        <Story />
      </main>
    ),
  ],
  args: {
    detail: pullRequestDetailFixture,
    owner: pullRequestDetailFixture.pullRequest.owner,
    repo: pullRequestDetailFixture.pullRequest.repo,
    number: pullRequestDetailFixture.pullRequest.number,
    locale: 'en-US',
    isFetching: false,
    now: pullRequestFixtureNow,
    onRefresh: () => {},
    onCopyLink: async () => {},
    onOpenWork: () => {},
    actions: actionsFixture,
  },
} satisfies Meta<typeof PullRequestDetailPanelView>

export default meta
type Story = StoryObj<typeof meta>

export const Summary: Story = {}

export const Timeline: Story = {
  args: {
    initialTab: 'timeline',
  },
}

export const Code: Story = {
  args: {
    initialTab: 'code',
  },
}

export const Refreshing: Story = {
  args: {
    isFetching: true,
  },
}

export const Loading: Story = {
  args: {
    detail: null,
    onOpenWork: undefined,
    actions: undefined,
  },
}

export const MergeBlocked: Story = {
  args: {
    actions: {
      ...actionsFixture,
      pullRequest: {
        ...pullRequestDetailFixture.pullRequest,
        canMerge: false,
        mergeBlockers: ['checks_pending', 'blocked'],
        allowedMergeMethods: ['squash'],
      },
    },
  },
}
