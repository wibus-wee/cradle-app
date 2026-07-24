import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { fn } from 'storybook/test'

import {
  workspaceSessionGroupFixtures,
} from './fixtures/workspace-sidebar'
import { WorkspaceSessionGroupSectionView } from './workspace-session-group-section-view'

function SessionGroupChildren() {
  return (
    <div className="flex flex-col gap-0.5 py-0.5 pl-2">
      <div className="rounded-lg px-2.5 py-1.5 text-xs text-sidebar-foreground/80">
        Refactor workspace sidebar
      </div>
      <div className="rounded-lg px-2.5 py-1.5 text-xs text-sidebar-foreground/80">
        Audit Storybook coverage
      </div>
    </div>
  )
}

function InteractiveSessionGroup() {
  const [expanded, setExpanded] = useState(true)
  const [activity, setActivity] = useState('No action selected')
  const group = workspaceSessionGroupFixtures.active

  return (
    <>
      <WorkspaceSessionGroupSectionView
        group={group}
        sessionCount={2}
        expanded={expanded}
        onToggleExpanded={() => setExpanded(current => !current)}
        onCreateSession={() => setActivity('Created session')}
        onRenameGroup={() => setActivity('Renamed group')}
        onDeleteGroup={() => setActivity('Deleted group')}
      >
        <SessionGroupChildren />
      </WorkspaceSessionGroupSectionView>
      <p className="sr-only" role="status">{activity}</p>
    </>
  )
}

const meta = {
  title: 'App/Workspace/Session Group',
  component: WorkspaceSessionGroupSectionView,
  decorators: [
    Story => (
      <main className="min-h-screen bg-muted/20 p-4 text-foreground sm:p-8">
        <section className="w-full max-w-80 border border-sidebar-border bg-sidebar p-2 shadow-sm">
          <Story />
        </section>
      </main>
    ),
  ],
  args: {
    group: workspaceSessionGroupFixtures.active,
    sessionCount: 2,
    expanded: true,
    children: <SessionGroupChildren />,
    onToggleExpanded: fn(),
    onCreateSession: fn(),
    onRenameGroup: fn(),
    onDeleteGroup: fn(),
  },
} satisfies Meta<typeof WorkspaceSessionGroupSectionView>

export default meta
type Story = StoryObj<typeof meta>

export const Interactive: Story = {
  render: () => <InteractiveSessionGroup />,
  parameters: {
    controls: { disable: true },
  },
}

export const Expanded: Story = {}

export const Collapsed: Story = {
  args: {
    expanded: false,
  },
}

export const Empty: Story = {
  args: {
    sessionCount: 0,
    children: null,
  },
}

export const Running: Story = {
  args: {
    group: workspaceSessionGroupFixtures.review,
    sessionCount: 3,
  },
}
