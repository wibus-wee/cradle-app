import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { AutomationDetailView } from './automation-detail-view'
import {
  automationArtifactFixtures,
  automationFixtureNow,
  automationRunFixtures,
  releaseAutomationFixture,
} from './fixtures/automation'

function AutomationDetailCatalog() {
  const [activity, setActivity] = useState('No automation action selected')

  return (
    <main className="min-h-screen bg-muted/20 p-4 text-foreground sm:p-8">
      <section className="mx-auto h-180 max-w-5xl overflow-hidden border border-border bg-background shadow-sm">
        <AutomationDetailView
          definition={releaseAutomationFixture}
          latestRun={automationRunFixtures[0]}
          runs={automationRunFixtures}
          runsLoading={false}
          artifacts={automationArtifactFixtures}
          artifactsLoading={false}
          workspaceNames={{ 'workspace-cradle': 'cradle-app' }}
          locale="en-US"
          now={automationFixtureNow}
          runNowPending={false}
          onEdit={definitionId => setActivity(`Edit ${definitionId}`)}
          onRunNow={definitionId => setActivity(`Run ${definitionId}`)}
          onStopRun={runId => setActivity(`Stop ${runId}`)}
          onTriageRun={(runId, status) =>
            setActivity(`${status} ${runId}`)}
        />
      </section>
      <p className="sr-only" role="status">{activity}</p>
    </main>
  )
}

const meta = {
  title: 'App/Automation/Detail',
  component: AutomationDetailCatalog,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
  },
} satisfies Meta<typeof AutomationDetailCatalog>

export default meta
type Story = StoryObj<typeof meta>

export const Overview: Story = {}

export const LoadingHistory: Story = {
  render: () => (
    <main className="min-h-screen bg-muted/20 p-4 text-foreground sm:p-8">
      <section className="mx-auto h-180 max-w-5xl overflow-hidden border border-border bg-background shadow-sm">
        <AutomationDetailView
          definition={releaseAutomationFixture}
          latestRun={automationRunFixtures[0]}
          runs={[]}
          runsLoading
          artifacts={[]}
          artifactsLoading
          workspaceNames={{ 'workspace-cradle': 'cradle-app' }}
          locale="en-US"
          now={automationFixtureNow}
          runNowPending
          onEdit={() => {}}
          onRunNow={() => {}}
          onStopRun={() => {}}
          onTriageRun={() => {}}
        />
      </section>
    </main>
  ),
}
