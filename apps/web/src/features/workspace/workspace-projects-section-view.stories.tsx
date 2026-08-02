import { FolderLine as FolderIcon } from '@mingcute/react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { fn } from 'storybook/test'

import {
  workspaceFixtures,
} from './fixtures/workspace-sidebar'
import { WorkspaceGroupDisclosureView } from './workspace-group-disclosure-view'
import { WorkspaceProjectsSectionView } from './workspace-projects-section-view'
import { WorkspaceRecentSessionListView } from './workspace-recent-session-list-view'
import type {
  WorkspaceSidebarEnvironmentFilter,
  WorkspaceSidebarGrouping,
  WorkspaceSidebarListFilters,
  WorkspaceSidebarOrderingDirection,
  WorkspaceSidebarSessionOrdering,
  WorkspaceSidebarSourceFilter,
  WorkspaceSidebarStatusFilter,
  WorkspaceSidebarWorkPrFilter,
} from './workspace-sidebar-ui-store'
import {
  DEFAULT_SESSION_PREVIEW_LIMIT,
  DEFAULT_WORKSPACE_SIDEBAR_LIST_FILTERS,
} from './workspace-sidebar-ui-store'

function toggleInList<T extends string>(list: readonly T[], value: T): T[] {
  return list.includes(value)
    ? list.filter(entry => entry !== value)
    : [...list, value]
}

const recentSessionFixtures = [
  { title: 'Refactor workspace sidebar', workspace: workspaceFixtures.local },
  { title: 'Review remote host settings', workspace: workspaceFixtures.remote },
  { title: 'Run the release verification suite', workspace: workspaceFixtures.local },
  { title: 'Fix missing workspace status', workspace: workspaceFixtures.missing },
  { title: 'Prepare the next desktop release', workspace: workspaceFixtures.remote },
  { title: 'Audit session activity labels', workspace: workspaceFixtures.local },
]

function WorkspaceProjectsSectionCatalog() {
  const [listFilters, setListFilters]
    = useState<WorkspaceSidebarListFilters>(DEFAULT_WORKSPACE_SIDEBAR_LIST_FILTERS)
  const [grouping, setGrouping]
    = useState<WorkspaceSidebarGrouping>('workspace')
  const [ordering, setOrdering]
    = useState<WorkspaceSidebarSessionOrdering>('updated')
  const [orderingDirection, setOrderingDirection]
    = useState<WorkspaceSidebarOrderingDirection>('desc')
  const [sessionPreviewLimit, setSessionPreviewLimit]
    = useState(DEFAULT_SESSION_PREVIEW_LIMIT)
  const [recentSessionsExpanded, setRecentSessionsExpanded] = useState(false)
  const [localExpanded, setLocalExpanded] = useState(true)
  const filteredEmpty = listFilters.statusFilters.includes('streaming')
    && listFilters.environmentFilters.includes('remote')
  const flatGrouping = grouping !== 'workspace'
  const recentSessionsToRender = recentSessionsExpanded
    ? recentSessionFixtures
    : recentSessionFixtures.slice(0, sessionPreviewLimit)
  const hiddenRecentSessionCount = Math.max(
    recentSessionFixtures.length - sessionPreviewLimit,
    0,
  )

  return (
    <WorkspaceProjectsSectionView
      hasWorkspaces
      filteredEmpty={filteredEmpty}
      listFilters={listFilters}
      grouping={grouping}
      ordering={ordering}
      orderingDirection={orderingDirection}
      sessionPreviewLimit={sessionPreviewLimit}
      adding={false}
      multiWorkspaceEnabled
      multiFolderCandidates={[
        workspaceFixtures.local,
        {
          ...workspaceFixtures.local,
          id: 'workspace-docs',
          name: 'docs',
          identifier: 'DOC',
          locator: {
            ...workspaceFixtures.local.locator,
            path: '/Users/demo/docs',
          },
        },
      ]}
      multiFolderCreating={false}
      hasUnreadWorkspaceSessions
      markingAllSessionsRead={false}
      onGroupingChange={setGrouping}
      onSessionOrderingChange={setOrdering}
      onOrderingDirectionChange={setOrderingDirection}
      onToggleStatusFilter={(filter: WorkspaceSidebarStatusFilter) =>
        setListFilters(current => ({
          ...current,
          statusFilters: toggleInList(current.statusFilters, filter),
        }))}
      onToggleWorkPrFilter={(filter: WorkspaceSidebarWorkPrFilter) =>
        setListFilters(current => ({
          ...current,
          workPrFilters: toggleInList(current.workPrFilters, filter),
        }))}
      onToggleEnvironmentFilter={(filter: WorkspaceSidebarEnvironmentFilter) =>
        setListFilters(current => ({
          ...current,
          environmentFilters: toggleInList(current.environmentFilters, filter),
        }))}
      onToggleSourceFilter={(filter: WorkspaceSidebarSourceFilter) =>
        setListFilters(current => ({
          ...current,
          sourceFilters: toggleInList(current.sourceFilters, filter),
        }))}
      onShowArchivedChange={showArchived =>
        setListFilters(current => ({ ...current, showArchived }))}
      onClearListFilters={() => setListFilters(DEFAULT_WORKSPACE_SIDEBAR_LIST_FILTERS)}
      onSessionPreviewLimitChange={setSessionPreviewLimit}
      onCollapseAll={() => {}}
      onAddFromPicker={() => {}}
      onCreateMultiFolder={async () => {}}
      onMarkAllAsRead={() => {}}
    >
      {flatGrouping
        ? (
            <WorkspaceRecentSessionListView
              sessionCount={recentSessionFixtures.length}
              expanded={recentSessionsExpanded}
              hiddenSessionCount={hiddenRecentSessionCount}
              onToggleExpanded={() => setRecentSessionsExpanded(current => !current)}
            >
              {recentSessionsToRender.map(({ title, workspace }) => (
                <div key={title} className="flex min-w-0 flex-col">
                  <div className="rounded-lg px-2.5 py-1.5 text-xs text-sidebar-foreground/80 hover:bg-accent/50">
                    {title}
                  </div>
                  <div className="flex min-w-0 items-center gap-1.5 px-2.5 py-0.5 pl-8 text-[11px] text-muted-foreground">
                    <FolderIcon className="size-3 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 truncate">{workspace.name}</span>
                  </div>
                </div>
              ))}
            </WorkspaceRecentSessionListView>
          )
        : (
            <>
              <WorkspaceGroupDisclosureView
                workspace={workspaceFixtures.local}
                workspacePinned
                workspaceActions={[]}
                runningSessionCount={0}
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
                runningSessionCount={2}
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
                runningSessionCount={0}
                expanded={false}
                overlays={null}
                onToggleExpanded={() => {}}
                onOpenWorkspace={() => {}}
              >
                {null}
              </WorkspaceGroupDisclosureView>
            </>
          )}
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
    listFilters: DEFAULT_WORKSPACE_SIDEBAR_LIST_FILTERS,
    grouping: 'workspace',
    ordering: 'updated',
    orderingDirection: 'desc',
    sessionPreviewLimit: DEFAULT_SESSION_PREVIEW_LIMIT,
    adding: false,
    multiWorkspaceEnabled: true,
    multiFolderCandidates: [workspaceFixtures.local],
    multiFolderCreating: false,
    hasUnreadWorkspaceSessions: true,
    markingAllSessionsRead: false,
    children: null,
    onGroupingChange: fn(),
    onSessionOrderingChange: fn(),
    onOrderingDirectionChange: fn(),
    onToggleStatusFilter: fn(),
    onToggleWorkPrFilter: fn(),
    onToggleEnvironmentFilter: fn(),
    onToggleSourceFilter: fn(),
    onShowArchivedChange: fn(),
    onClearListFilters: fn(),
    onSessionPreviewLimitChange: fn(),
    onCollapseAll: fn(),
    onAddFromPicker: fn(),
    onCreateMultiFolder: fn(),
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
    listFilters: {
      ...DEFAULT_WORKSPACE_SIDEBAR_LIST_FILTERS,
      statusFilters: ['streaming'],
    },
    hasUnreadWorkspaceSessions: false,
  },
}

export const MarkingAllRead: Story = {
  args: {
    markingAllSessionsRead: true,
  },
}

function FlatSectionFixture({ label, titles }: { label: string, titles: string[] }) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="px-2.5 pb-0.5 pt-2 text-[11px] font-medium text-muted-foreground">
        {label}
      </div>
      {titles.map((title, index) => (
        <div key={title} className="flex min-w-0 flex-col">
          <div className="rounded-lg px-2.5 py-1.5 text-xs text-sidebar-foreground/80 hover:bg-accent/50">
            {title}
          </div>
          <div className="flex min-w-0 items-center gap-1.5 px-2.5 py-0.5 pl-8 text-[11px] text-muted-foreground">
            <FolderIcon className="size-3 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">
              {recentSessionFixtures[index % recentSessionFixtures.length].workspace.name}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

export const GroupedByStatus: Story = {
  args: {
    grouping: 'status',
    children: (
      <>
        <FlatSectionFixture label="Running" titles={['Refactor workspace sidebar']} />
        <FlatSectionFixture label="Needs you" titles={['Review remote host settings']} />
        <FlatSectionFixture
          label="Idle"
          titles={['Run the release verification suite', 'Audit session activity labels']}
        />
      </>
    ),
  },
}

export const GroupedByUpdated: Story = {
  args: {
    grouping: 'updated',
    children: (
      <>
        <FlatSectionFixture label="Today" titles={['Refactor workspace sidebar']} />
        <FlatSectionFixture
          label="Yesterday"
          titles={['Review remote host settings', 'Fix missing workspace status']}
        />
        <FlatSectionFixture label="Earlier" titles={['Prepare the next desktop release']} />
      </>
    ),
  },
}
