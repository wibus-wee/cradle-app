import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { Button } from '~/components/ui/button'

import { AutomationCreatePanelView } from './automation-create-panel-view'
import type { CreateAutomationDraft } from './automation-draft'
import {
  automationDraftFixture,
  automationWorkspaceFixtures,
} from './fixtures/automation'

function AutomationCreatePanelCatalog() {
  const [draft, setDraft] = useState<CreateAutomationDraft>(
    automationDraftFixture,
  )
  const [activity, setActivity] = useState('No form action selected')

  return (
    <main className="h-screen min-h-160 bg-muted/20 p-2 text-foreground sm:p-6">
      <section className="mx-auto h-full max-w-5xl overflow-hidden border border-border bg-background shadow-sm">
        <AutomationCreatePanelView
          draft={draft}
          workspaces={automationWorkspaceFixtures}
          runtimeDescription="Choose the runtime, provider target, model, and thinking effort used by each run."
          selectedModelLabel="gpt-5.4"
          saving={false}
          error={null}
          saveEnabled
          mode="create"
          onChange={setDraft}
          onCancel={() => setActivity('Cancelled draft')}
          onSave={() => setActivity(`Saved ${draft.title}`)}
          runtimePicker={(
            <>
              <Button type="button" variant="outline" size="sm">
                Codex app-server
              </Button>
              <Button type="button" variant="ghost" size="sm">
                Codex / gpt-5.4 / high
              </Button>
            </>
          )}
        />
      </section>
      <p className="sr-only" role="status">{activity}</p>
    </main>
  )
}

const meta = {
  title: 'App/Automation/Create Panel',
  component: AutomationCreatePanelCatalog,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
  },
} satisfies Meta<typeof AutomationCreatePanelCatalog>

export default meta
type Story = StoryObj<typeof meta>

export const Create: Story = {}

export const EditWithError: Story = {
  render: () => (
    <main className="h-screen min-h-160 bg-muted/20 p-2 text-foreground sm:p-6">
      <section className="mx-auto h-full max-w-5xl overflow-hidden border border-border bg-background shadow-sm">
        <AutomationCreatePanelView
          draft={automationDraftFixture}
          workspaces={automationWorkspaceFixtures}
          runtimeDescription="The selected provider target is temporarily unavailable."
          selectedModelLabel="gpt-5.4"
          saving={false}
          error="The provider target could not be reached."
          saveEnabled={false}
          mode="edit"
          onChange={() => {}}
          onCancel={() => {}}
          onSave={() => {}}
          runtimePicker={(
            <Button type="button" variant="outline" size="sm" disabled>
              Codex app-server
            </Button>
          )}
        />
      </section>
    </main>
  ),
}
