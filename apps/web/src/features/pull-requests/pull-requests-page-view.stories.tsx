import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  pullRequestEntriesFixture,
  pullRequestFixtureNow,
  pullRequestViewerFixture,
} from './fixtures/pull-requests'
import { PullRequestsPageView } from './pull-requests-page-view'

const idleFeed = {
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: () => {},
}

const meta = {
  title: 'App/Pull Requests/List',
  component: PullRequestsPageView,
  decorators: [
    Story => (
      <main className="h-screen min-h-150 bg-muted/20 p-2 sm:p-6">
        <section className="mx-auto h-full max-w-6xl overflow-hidden border border-border bg-background shadow-sm">
          <Story />
        </section>
      </main>
    ),
  ],
  args: {
    entries: pullRequestEntriesFixture,
    viewer: pullRequestViewerFixture,
    pending: false,
    authRequired: false,
    authoredFeed: {
      ...idleFeed,
      hasNextPage: true,
    },
    reviewingFeed: idleFeed,
    selectedRef: pullRequestEntriesFixture[0].id,
    now: pullRequestFixtureNow,
    onPrefetch: () => {},
    onSelect: () => {},
  },
} satisfies Meta<typeof PullRequestsPageView>

export default meta
type Story = StoryObj<typeof meta>

export const Populated: Story = {}

export const Loading: Story = {
  args: {
    entries: [],
    viewer: null,
    pending: true,
    selectedRef: undefined,
  },
}

export const Empty: Story = {
  args: {
    entries: [],
    selectedRef: undefined,
  },
}

export const GitHubAuthenticationRequired: Story = {
  args: {
    entries: [],
    viewer: null,
    authRequired: true,
    selectedRef: undefined,
  },
}
