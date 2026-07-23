import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import {
  workspaceSessionFixtures,
  workspaceWorkFixture,
} from './fixtures/workspace-sidebar'
import { WorkspaceSessionItemView } from './workspace-session-item-view'

const noop = () => {}
const asyncNoop = async () => {}

function WorkspaceSessionItemCatalog() {
  const [activity, setActivity] = useState('No session action selected')

  const sharedCallbacks = {
    onPrepareOpen: noop,
    onPrefetch: noop,
    onPreview: noop,
    onPreviewLeave: noop,
    onOpenInNewWindow: noop,
    onRenameCommit: asyncNoop,
    onRenameCancel: noop,
    onOpenMenu: () => setActivity('Opened session menu'),
  }

  return (
    <main className="min-h-screen bg-muted/20 p-4 text-foreground sm:p-8">
      <section className="mx-auto w-full max-w-80 border border-sidebar-border bg-sidebar p-2 shadow-sm">
        <div className="px-2.5 pb-2 pt-1 text-[11px] font-medium text-muted-foreground">
          Session states
        </div>
        <div className="grid gap-0.5">
          <WorkspaceSessionItemView
            {...sharedCallbacks}
            session={workspaceSessionFixtures.active}
            work={null}
            active
            dimmed={false}
            isStreaming={false}
            attentionKind={null}
            hasError={false}
            isRenaming={false}
            isRegeneratingTitle={false}
            runtimeIcon={undefined}
            relativeTime="now"
            draggable
            canOpenInNewWindow
            onOpen={() => setActivity('Opened active session')}
          />
          <WorkspaceSessionItemView
            {...sharedCallbacks}
            session={workspaceSessionFixtures.unread}
            work={null}
            active={false}
            dimmed={false}
            isStreaming={false}
            attentionKind={null}
            hasError={false}
            isRenaming={false}
            isRegeneratingTitle={false}
            runtimeIcon={undefined}
            relativeTime="2m"
            draggable
            canOpenInNewWindow
            onOpen={() => setActivity('Opened unread session')}
          />
          <WorkspaceSessionItemView
            {...sharedCallbacks}
            session={workspaceSessionFixtures.running}
            work={null}
            active={false}
            dimmed={false}
            isStreaming
            attentionKind={null}
            hasError={false}
            isRenaming={false}
            isRegeneratingTitle={false}
            runtimeIcon={undefined}
            relativeTime="now"
            draggable
            canOpenInNewWindow
            onOpen={() => setActivity('Opened running session')}
          />
          <WorkspaceSessionItemView
            {...sharedCallbacks}
            session={{
              ...workspaceSessionFixtures.running,
              id: 'session-user-input',
              title: 'Choose the deployment target',
            }}
            work={null}
            active={false}
            dimmed={false}
            isStreaming
            attentionKind="userInput"
            hasError={false}
            isRenaming={false}
            isRegeneratingTitle={false}
            runtimeIcon={undefined}
            relativeTime="now"
            draggable
            canOpenInNewWindow
            onOpen={() => setActivity('Opened input request')}
          />
          <WorkspaceSessionItemView
            {...sharedCallbacks}
            session={{
              ...workspaceSessionFixtures.running,
              id: 'session-tool-approval',
              title: 'Approve release command',
            }}
            work={null}
            active={false}
            dimmed={false}
            isStreaming
            attentionKind="toolApproval"
            hasError={false}
            isRenaming={false}
            isRegeneratingTitle={false}
            runtimeIcon={undefined}
            relativeTime="now"
            draggable
            canOpenInNewWindow
            onOpen={() => setActivity('Opened approval request')}
          />
          <WorkspaceSessionItemView
            {...sharedCallbacks}
            session={{
              ...workspaceSessionFixtures.unread,
              id: 'session-error',
              title: 'Provider connection failed',
              status: 'error',
              unread: false,
            }}
            work={null}
            active={false}
            dimmed={false}
            isStreaming={false}
            attentionKind={null}
            hasError
            isRenaming={false}
            isRegeneratingTitle={false}
            runtimeIcon={undefined}
            relativeTime="8m"
            draggable
            canOpenInNewWindow
            onOpen={() => setActivity('Opened failed session')}
          />
          <WorkspaceSessionItemView
            {...sharedCallbacks}
            session={workspaceSessionFixtures.system}
            work={null}
            active={false}
            dimmed
            isStreaming={false}
            attentionKind={null}
            hasError={false}
            isRenaming={false}
            isRegeneratingTitle={false}
            runtimeIcon={undefined}
            relativeTime="1h"
            draggable
            canOpenInNewWindow
            onOpen={() => setActivity('Opened automation session')}
          />
          <WorkspaceSessionItemView
            {...sharedCallbacks}
            session={{
              ...workspaceSessionFixtures.active,
              id: 'session-regenerating',
              title: 'Generating a better title',
              pinned: 0,
            }}
            work={null}
            active={false}
            dimmed={false}
            isStreaming={false}
            attentionKind={null}
            hasError={false}
            isRenaming={false}
            isRegeneratingTitle
            runtimeIcon={undefined}
            relativeTime="3m"
            draggable
            canOpenInNewWindow
            onOpen={() => setActivity('Opened regenerating session')}
          />
          <WorkspaceSessionItemView
            {...sharedCallbacks}
            session={{
              ...workspaceSessionFixtures.active,
              id: workspaceWorkFixture.primarySessionId,
              pinned: 0,
            }}
            work={workspaceWorkFixture}
            active={false}
            dimmed={false}
            isStreaming={false}
            attentionKind={null}
            hasError={false}
            isRenaming={false}
            isRegeneratingTitle={false}
            runtimeIcon={undefined}
            relativeTime="now"
            draggable={false}
            canOpenInNewWindow
            onOpen={() => setActivity('Opened Work')}
          />
          <WorkspaceSessionItemView
            {...sharedCallbacks}
            session={workspaceSessionFixtures.active}
            work={null}
            active={false}
            dimmed={false}
            isStreaming={false}
            attentionKind={null}
            hasError={false}
            isRenaming
            isRegeneratingTitle={false}
            runtimeIcon={undefined}
            relativeTime="now"
            draggable={false}
            canOpenInNewWindow
            onOpen={noop}
          />
        </div>
      </section>
      <p className="sr-only" role="status">{activity}</p>
    </main>
  )
}

const meta = {
  title: 'App/Workspace/Session Item',
  component: WorkspaceSessionItemCatalog,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
  },
} satisfies Meta<typeof WorkspaceSessionItemCatalog>

export default meta
type Story = StoryObj<typeof meta>

export const States: Story = {}
