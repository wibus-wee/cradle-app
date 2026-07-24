import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { AwaitPanelView } from './await-panel-view'
import {
  activeAwaitStatusesFixture,
  completedAwaitFixture,
  failedDeliveryAwaitFixture,
  pendingCIAwaitFixture,
  pendingReviewAwaitFixture,
  reviewAwaitStatusesFixture,
} from './fixtures/await-panel'
import type { GitHubAwaitComposerViewProps } from './github-await-composer-view'

const composerFixture = {
  hasSession: true,
  hasWorkspace: true,
  detectedRepository: {
    owner: 'wibus-wee',
    repo: 'cradle-app',
    fullName: 'wibus-wee/cradle-app',
    remoteName: 'origin',
    remoteUrl: 'git@github.com:wibus-wee/cradle-app.git',
  },
  detectedPullRequestNumber: 71,
  repositoryDetectionStatus: 'ready',
  isCreating: false,
  onCreate: () => {},
} satisfies GitHubAwaitComposerViewProps

function AwaitPanelFrame({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <main className="flex min-h-screen items-stretch justify-center bg-muted/20 p-4 text-foreground sm:p-8">
      <section className="flex min-h-150 w-full max-w-100 flex-col overflow-hidden border border-border bg-background shadow-sm">
        <header className="border-b border-border px-3 py-2">
          <h1 className="text-xs font-medium">Session awaits</h1>
        </header>
        {children}
      </section>
    </main>
  )
}

function ActiveChecksStory() {
  const [activity, setActivity] = useState('No action selected')

  return (
    <AwaitPanelFrame>
      <AwaitPanelView
        sessionSelected
        isReady
        awaits={[pendingCIAwaitFixture, completedAwaitFixture]}
        liveStatusByAwaitId={activeAwaitStatusesFixture}
        composer={composerFixture}
        onCancel={awaitId => setActivity(`Cancel ${awaitId}`)}
        onRetryDelivery={awaitId => setActivity(`Retry ${awaitId}`)}
        onBypassCheck={(awaitId, checkName) =>
          setActivity(`Bypass ${checkName} for ${awaitId}`)}
      />
      <p className="sr-only" role="status">{activity}</p>
    </AwaitPanelFrame>
  )
}

const meta = {
  title: 'App/Awaits/Panel',
  component: ActiveChecksStory,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
  },
} satisfies Meta<typeof ActiveChecksStory>

export default meta
type Story = StoryObj<typeof meta>

export const ActiveChecks: Story = {}

export const ReviewAndDeliveryFailure: Story = {
  render: () => (
    <AwaitPanelFrame>
      <AwaitPanelView
        sessionSelected
        isReady
        awaits={[pendingReviewAwaitFixture, failedDeliveryAwaitFixture]}
        liveStatusByAwaitId={reviewAwaitStatusesFixture}
        composer={composerFixture}
        onCancel={() => {}}
        onRetryDelivery={() => {}}
        onBypassCheck={() => {}}
      />
    </AwaitPanelFrame>
  ),
}

export const Composer: Story = {
  render: () => (
    <AwaitPanelFrame>
      <AwaitPanelView
        sessionSelected
        isReady
        awaits={[]}
        liveStatusByAwaitId={new Map()}
        composer={composerFixture}
        onCancel={() => {}}
        onRetryDelivery={() => {}}
        onBypassCheck={() => {}}
      />
    </AwaitPanelFrame>
  ),
}

export const NoSession: Story = {
  render: () => (
    <AwaitPanelFrame>
      <AwaitPanelView
        sessionSelected={false}
        isReady={false}
        awaits={[]}
        liveStatusByAwaitId={new Map()}
        composer={{ ...composerFixture, hasSession: false }}
        onCancel={() => {}}
        onRetryDelivery={() => {}}
        onBypassCheck={() => {}}
      />
    </AwaitPanelFrame>
  ),
}
