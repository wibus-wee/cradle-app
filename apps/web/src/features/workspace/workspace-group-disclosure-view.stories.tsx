import {
  DeleteLine as TrashIcon,
  ExternalLinkLine as OpenIcon,
  PencilLine as RenameIcon,
  PinLine as PinIcon,
} from '@mingcute/react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import {
  workspaceFixtures,
  workspaceSessionFixtures,
} from './fixtures/workspace-sidebar'
import type { WorkspaceMenuAction } from './workspace-group-disclosure-view'
import { WorkspaceGroupDisclosureView } from './workspace-group-disclosure-view'
import { WorkspaceSessionItemView } from './workspace-session-item-view'

const noop = () => {}
const asyncNoop = async () => {}

function createWorkspaceActions(
  workspaceId: string,
  recordActivity: (message: string) => void,
): WorkspaceMenuAction[] {
  return [
    {
      key: 'open',
      label: 'Open workspace',
      icon: <OpenIcon />,
      testId: `fixture-workspace-open-${workspaceId}`,
      invoke: () => recordActivity(`Opened ${workspaceId}`),
    },
    {
      key: 'rename',
      label: 'Rename',
      icon: <RenameIcon />,
      testId: `fixture-workspace-rename-${workspaceId}`,
      invoke: () => recordActivity(`Renamed ${workspaceId}`),
    },
    {
      key: 'pin',
      label: 'Pin project',
      icon: <PinIcon />,
      testId: `fixture-workspace-pin-${workspaceId}`,
      invoke: () => recordActivity(`Pinned ${workspaceId}`),
      separatorBefore: true,
    },
    {
      key: 'remove',
      label: 'Remove workspace',
      icon: <TrashIcon />,
      testId: `fixture-workspace-remove-${workspaceId}`,
      invoke: () => recordActivity(`Removed ${workspaceId}`),
      variant: 'destructive',
      separatorBefore: true,
    },
  ]
}

function WorkspaceGroupDisclosureCatalog() {
  const [localExpanded, setLocalExpanded] = useState(true)
  const [missingExpanded, setMissingExpanded] = useState(false)
  const [remoteExpanded, setRemoteExpanded] = useState(false)
  const [activity, setActivity] = useState('No workspace action selected')

  return (
    <main className="min-h-screen bg-muted/20 p-4 text-foreground sm:p-8">
      <section className="mx-auto w-full max-w-80 border border-sidebar-border bg-sidebar p-2 shadow-sm">
        <div className="px-2.5 pb-2 pt-1 text-[11px] font-medium text-muted-foreground">
          Workspace groups
        </div>
        <div className="grid gap-1">
          <WorkspaceGroupDisclosureView
            workspace={workspaceFixtures.local}
            workspacePinned
            workspaceActions={createWorkspaceActions(
              workspaceFixtures.local.id,
              setActivity,
            )}
            expanded={localExpanded}
            overlays={null}
            onToggleExpanded={() => setLocalExpanded(current => !current)}
            onOpenWorkspace={() => setActivity('Opened local workspace')}
          >
            <div className="ml-4.25 border-l border-sidebar-border/50 py-0.5 pl-2">
              <WorkspaceSessionItemView
                session={workspaceSessionFixtures.active}
                work={null}
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
                canOpenInNewWindow={false}
                onOpen={() => setActivity('Opened fixture session')}
                onPrepareOpen={noop}
                onPrefetch={noop}
                onPreview={noop}
                onPreviewLeave={noop}
                onOpenInNewWindow={noop}
                onRenameCommit={asyncNoop}
                onRenameCancel={noop}
                onOpenMenu={noop}
              />
            </div>
          </WorkspaceGroupDisclosureView>

          <WorkspaceGroupDisclosureView
            workspace={workspaceFixtures.missing}
            workspacePinned={false}
            workspaceActions={createWorkspaceActions(
              workspaceFixtures.missing.id,
              setActivity,
            )}
            expanded={missingExpanded}
            overlays={null}
            onToggleExpanded={() => setMissingExpanded(current => !current)}
            onOpenWorkspace={() => setActivity('Opened missing workspace')}
          >
            <p className="ml-4.25 border-l border-sidebar-border/50 px-4 py-2 text-xs text-muted-foreground">
              Relink this project to restore its sessions.
            </p>
          </WorkspaceGroupDisclosureView>

          <WorkspaceGroupDisclosureView
            workspace={workspaceFixtures.remote}
            workspacePinned={false}
            workspaceActions={createWorkspaceActions(
              workspaceFixtures.remote.id,
              setActivity,
            )}
            expanded={remoteExpanded}
            overlays={null}
            onToggleExpanded={() => setRemoteExpanded(current => !current)}
            onOpenWorkspace={() => setActivity('Opened remote workspace')}
          >
            <p className="ml-4.25 border-l border-sidebar-border/50 px-4 py-2 text-xs text-muted-foreground">
              Remote sessions are ready.
            </p>
          </WorkspaceGroupDisclosureView>
        </div>
      </section>
      <p className="sr-only" role="status">{activity}</p>
    </main>
  )
}

const meta = {
  title: 'App/Workspace/Workspace Group',
  component: WorkspaceGroupDisclosureCatalog,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
  },
} satisfies Meta<typeof WorkspaceGroupDisclosureCatalog>

export default meta
type Story = StoryObj<typeof meta>

export const States: Story = {}
