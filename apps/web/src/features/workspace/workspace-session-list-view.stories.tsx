import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import {
  workspaceSessionFixtures,
} from './fixtures/workspace-sidebar'
import type { WorkspaceSession } from './use-session'
import { WorkspaceSessionItemView } from './workspace-session-item-view'
import { WorkspaceSessionListView } from './workspace-session-list-view'

const noop = () => {}
const asyncNoop = async () => {}
const fixtureSessions = Object.values(workspaceSessionFixtures)

function renderSessionItem(
  session: WorkspaceSession,
  index: number,
) {
  const isStreaming = session.status === 'streaming'

  return (
    <WorkspaceSessionItemView
      key={session.id}
      session={session}
      work={null}
      active={index === 0}
      dimmed={session.origin !== 'manual'}
      isStreaming={isStreaming}
      attentionKind={isStreaming ? 'userInput' : null}
      hasError={false}
      isRenaming={false}
      isRegeneratingTitle={false}
      runtimeIcon={undefined}
      relativeTime={index === 0 ? 'now' : `${index * 2}m`}
      draggable={false}
      canOpenInNewWindow={false}
      onOpen={noop}
      onPrepareOpen={noop}
      onPrefetch={noop}
      onPreview={noop}
      onPreviewLeave={noop}
      onOpenInNewWindow={noop}
      onRenameCommit={asyncNoop}
      onRenameCancel={noop}
      onOpenMenu={noop}
    />
  )
}

function WorkspaceSessionListCatalog() {
  const [expanded, setExpanded] = useState(false)
  const visibleSessions = expanded
    ? fixtureSessions
    : fixtureSessions.slice(0, 2)

  return (
    <main className="min-h-screen bg-muted/20 p-4 text-foreground sm:p-8">
      <section className="mx-auto w-full max-w-80 border border-sidebar-border bg-sidebar p-2 shadow-sm">
        <div className="px-2.5 pb-2 pt-1 text-[11px] font-medium text-muted-foreground">
          Session list
        </div>
        <WorkspaceSessionListView
          workspaceId="workspace-cradle"
          sessionCount={fixtureSessions.length}
          expanded={expanded}
          hiddenSessionCount={2}
          onToggleExpanded={() => setExpanded(current => !current)}
        >
          {visibleSessions.map(renderSessionItem)}
        </WorkspaceSessionListView>

        <div className="px-2.5 pb-1 pt-4 text-[11px] font-medium text-muted-foreground">
          Empty state
        </div>
        <WorkspaceSessionListView
          workspaceId="workspace-empty"
          sessionCount={0}
          expanded={false}
          hiddenSessionCount={0}
          onToggleExpanded={noop}
        >
          {null}
        </WorkspaceSessionListView>
      </section>
    </main>
  )
}

const meta = {
  title: 'App/Workspace/Session List',
  component: WorkspaceSessionListCatalog,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
  },
} satisfies Meta<typeof WorkspaceSessionListCatalog>

export default meta
type Story = StoryObj<typeof meta>

export const States: Story = {}
