import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { Button } from '~/components/ui/button'

import { AutomationCreatePanelView } from './automation-create-panel-view'
import { AutomationDashboardView } from './automation-dashboard-view'
import { AutomationDetailView } from './automation-detail-view'
import type { CreateAutomationDraft } from './automation-draft'
import { AutomationEmptySelectionView } from './automation-empty-selection-view'
import {
  automationArtifactFixtures,
  automationDefinitionFixtures,
  automationDraftFixture,
  automationFixtureNow,
  automationRunFixtures,
  automationWorkspaceFixtures,
} from './fixtures/automation'

function AutomationDashboardCatalog() {
  const [selectedId, setSelectedId] = useState(
    automationDefinitionFixtures[0].id,
  )
  const [draft, setDraft] = useState<CreateAutomationDraft | null>(null)
  const selectedDefinition = automationDefinitionFixtures.find(
    definition => definition.id === selectedId,
  ) ?? null

  const content = draft
    ? (
        <AutomationCreatePanelView
          draft={draft}
          workspaces={automationWorkspaceFixtures}
          runtimeDescription="Choose the runtime and model used by each run."
          selectedModelLabel="gpt-5.4"
          saving={false}
          error={null}
          saveEnabled
          mode="create"
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={() => setDraft(null)}
          runtimePicker={(
            <Button type="button" variant="outline" size="sm">
              Codex / gpt-5.4 / high
            </Button>
          )}
        />
      )
    : selectedDefinition
      ? (
          <AutomationDetailView
            definition={selectedDefinition}
            latestRun={automationRunFixtures[0]}
            runs={automationRunFixtures}
            runsLoading={false}
            artifacts={automationArtifactFixtures}
            artifactsLoading={false}
            workspaceNames={{
              'workspace-cradle': 'cradle-app',
              'workspace-docs': 'product-docs',
            }}
            locale="en-US"
            now={automationFixtureNow}
            runNowPending={false}
            onEdit={() => setDraft(automationDraftFixture)}
            onRunNow={() => {}}
            onStopRun={() => {}}
            onTriageRun={() => {}}
          />
        )
      : (
          <AutomationEmptySelectionView
            onCreate={() => setDraft(automationDraftFixture)}
          />
        )

  return (
    <main className="h-screen min-h-160 bg-muted/20 p-2 text-foreground sm:p-6">
      <section className="mx-auto h-full max-w-7xl overflow-hidden border border-border bg-background shadow-sm">
        <AutomationDashboardView
          definitions={automationDefinitionFixtures}
          triageRuns={automationRunFixtures.slice(0, 2)}
          workspaces={automationWorkspaceFixtures}
          selectedAutomationId={draft ? null : selectedDefinition?.id ?? null}
          selectedLatestRun={draft ? null : automationRunFixtures[0]}
          workspaceFilter={null}
          hasDraft={Boolean(draft)}
          definitionsLoading={false}
          triageLoading={false}
          error={null}
          automationReady
          runNowPending={false}
          contentKey={draft ? 'draft' : selectedId}
          content={content}
          onCreate={() => setDraft(automationDraftFixture)}
          onRefresh={() => {}}
          onRunNow={() => {}}
          onSelectDefinition={(definitionId) => {
            setDraft(null)
            setSelectedId(definitionId)
          }}
          onSelectDraft={() => {}}
          onWorkspaceFilterChange={() => {}}
        />
      </section>
    </main>
  )
}

const meta = {
  title: 'App/Automation/Dashboard',
  component: AutomationDashboardCatalog,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
  },
} satisfies Meta<typeof AutomationDashboardCatalog>

export default meta
type Story = StoryObj<typeof meta>

export const Populated: Story = {}

export const Loading: Story = {
  render: () => (
    <main className="h-screen min-h-160 bg-muted/20 p-2 text-foreground sm:p-6">
      <section className="mx-auto h-full max-w-7xl overflow-hidden border border-border bg-background shadow-sm">
        <AutomationDashboardView
          definitions={[]}
          triageRuns={[]}
          workspaces={automationWorkspaceFixtures}
          selectedAutomationId={null}
          selectedLatestRun={null}
          workspaceFilter={null}
          hasDraft={false}
          definitionsLoading
          triageLoading
          error={null}
          automationReady={false}
          runNowPending={false}
          contentKey="loading"
          content={<AutomationEmptySelectionView onCreate={() => {}} />}
          onCreate={() => {}}
          onRefresh={() => {}}
          onRunNow={() => {}}
          onSelectDefinition={() => {}}
          onSelectDraft={() => {}}
          onWorkspaceFilterChange={() => {}}
        />
      </section>
    </main>
  ),
}
