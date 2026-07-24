import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { fn } from 'storybook/test'

import {
  workspaceFixtures,
} from './fixtures/workspace-sidebar'
import { WorkspaceGroupDisclosureView } from './workspace-group-disclosure-view'
import { WorkspaceProjectsSectionView } from './workspace-projects-section-view'
import type {
  WorkspaceSidebarProjectFilter,
  WorkspaceSidebarProjectSortDirection,
  WorkspaceSidebarProjectSortKey,
} from './workspace-sidebar-ui-store'

function WorkspaceProjectsSectionCatalog() {
  const [projectFilter, setProjectFilter]
    = useState<WorkspaceSidebarProjectFilter>('all')
  const [projectSortKey, setProjectSortKey]
    = useState<WorkspaceSidebarProjectSortKey>('name')
  const [projectSortDirection, setProjectSortDirection]
    = useState<WorkspaceSidebarProjectSortDirection>('asc')
  const [projectPinnedFirst, setProjectPinnedFirst] = useState(true)
  const [localExpanded, setLocalExpanded] = useState(true)
  const filteredEmpty = projectFilter === 'running'

  return (
    <WorkspaceProjectsSectionView
      hasWorkspaces
      filteredEmpty={filteredEmpty}
      projectFilter={projectFilter}
      projectSortKey={projectSortKey}
      projectSortDirection={projectSortDirection}
      projectPinnedFirst={projectPinnedFirst}
      adding={false}
      multiWorkspaceEnabled
      hasUnreadWorkspaceSessions
      markingAllSessionsRead={false}
      onProjectFilterChange={setProjectFilter}
      onProjectSortKeyChange={setProjectSortKey}
      onProjectSortDirectionChange={setProjectSortDirection}
      onProjectPinnedFirstChange={setProjectPinnedFirst}
      onAddFromPicker={() => {}}
      onOpenMultiWorkspaceDialog={() => {}}
      onMarkAllAsRead={() => {}}
    >
      <WorkspaceGroupDisclosureView
        workspace={workspaceFixtures.local}
        workspacePinned
        workspaceActions={[]}
        expanded={localExpanded}
        overlays={null}
        onToggleExpanded={() => setLocalExpanded(current => !current)}
        onOpenWorkspace={() => {}}
      >
        <div className="ml-4.25 border-l border-sidebar-border/50 px-4 py-2 text-[11px] text-muted-foreground">
          Refactor workspace sidebar
        </div>
      </WorkspaceGroupDisclosureView>
      <WorkspaceGroupDisclosureView
        workspace={workspaceFixtures.remote}
        workspacePinned={false}
        workspaceActions={[]}
        expanded={false}
        overlays={null}
        onToggleExpanded={() => {}}
        onOpenWorkspace={() => {}}
      >
        {null}
      </WorkspaceGroupDisclosureView>
      <WorkspaceGroupDisclosureView
        workspace={workspaceFixtures.missing}
        workspacePinned={false}
        workspaceActions={[]}
        expanded={false}
        overlays={null}
        onToggleExpanded={() => {}}
        onOpenWorkspace={() => {}}
      >
        {null}
      </WorkspaceGroupDisclosureView>
    </WorkspaceProjectsSectionView>
  )
}

const meta = {
  title: 'App/Workspace/Projects Section',
  component: WorkspaceProjectsSectionView,
  decorators: [
    Story => (
      <main className="min-h-screen bg-muted/20 p-4 text-foreground sm:p-8">
        <section className="w-full max-w-80 border border-sidebar-border bg-sidebar py-2 shadow-sm">
          <Story />
        </section>
      </main>
    ),
  ],
  args: {
    hasWorkspaces: true,
    filteredEmpty: false,
    projectFilter: 'all',
    projectSortKey: 'name',
    projectSortDirection: 'asc',
    projectPinnedFirst: true,
    adding: false,
    multiWorkspaceEnabled: true,
    hasUnreadWorkspaceSessions: true,
    markingAllSessionsRead: false,
    children: null,
    onProjectFilterChange: fn(),
    onProjectSortKeyChange: fn(),
    onProjectSortDirectionChange: fn(),
    onProjectPinnedFirstChange: fn(),
    onAddFromPicker: fn(),
    onOpenMultiWorkspaceDialog: fn(),
    onMarkAllAsRead: fn(),
  },
} satisfies Meta<typeof WorkspaceProjectsSectionView>

export default meta
type Story = StoryObj<typeof meta>

export const Interactive: Story = {
  render: () => <WorkspaceProjectsSectionCatalog />,
  parameters: {
    controls: { disable: true },
  },
}

export const Empty: Story = {
  args: {
    hasWorkspaces: false,
    hasUnreadWorkspaceSessions: false,
  },
}

export const FilteredEmpty: Story = {
  args: {
    filteredEmpty: true,
    projectFilter: 'running',
    hasUnreadWorkspaceSessions: false,
  },
}

export const MarkingAllRead: Story = {
  args: {
    markingAllSessionsRead: true,
  },
}
