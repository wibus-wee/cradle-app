import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { AwaitsOverviewView } from './awaits-overview-view'
import { awaitsFixtureNow, pendingAwaitFixtures } from './fixtures/awaits'

function AwaitsOverviewCatalog() {
  const [activity, setActivity] = useState('No await selected')

  return (
    <main className="h-screen min-h-120 bg-background text-foreground">
      <AwaitsOverviewView
        awaits={pendingAwaitFixtures}
        isReady
        hasError={false}
        now={awaitsFixtureNow}
        onOpenChat={sessionId => setActivity(`Open ${sessionId}`)}
        onPreloadChat={sessionId => setActivity(`Preload ${sessionId}`)}
      />
      <p className="sr-only" role="status">{activity}</p>
    </main>
  )
}

const meta = {
  title: 'App/Awaits/Overview',
  component: AwaitsOverviewCatalog,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
  },
} satisfies Meta<typeof AwaitsOverviewCatalog>

export default meta
type Story = StoryObj<typeof meta>

export const Pending: Story = {}

export const Empty: Story = {
  render: () => (
    <main className="h-screen min-h-120 bg-background text-foreground">
      <AwaitsOverviewView
        awaits={[]}
        isReady
        hasError={false}
        onOpenChat={() => {}}
        onPreloadChat={() => {}}
      />
    </main>
  ),
}

export const Error: Story = {
  render: () => (
    <main className="h-screen min-h-120 bg-background text-foreground">
      <AwaitsOverviewView
        awaits={[]}
        isReady={false}
        hasError
        onOpenChat={() => {}}
        onPreloadChat={() => {}}
      />
    </main>
  ),
}
