import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { Button } from '~/components/ui/button'

import {
  workspaceSessionFixtures,
  workspaceSessionGroupFixtures,
} from './fixtures/workspace-sidebar'
import type { WorkspaceSession } from './use-session'
import { WorkspaceSessionActionsMenuView } from './workspace-session-actions-menu-view'
import type { WorkspaceSessionMenuAnchor } from './workspace-session-item-view'

type MenuState = 'standard' | 'unreadPinned' | 'grouped'

const groupedSession = {
  ...workspaceSessionFixtures.running,
  id: 'session-grouped',
  title: 'Review rendering seam',
  sessionGroupId: workspaceSessionGroupFixtures.active.id,
} satisfies WorkspaceSession

const standardSession = {
  ...workspaceSessionFixtures.active,
  pinned: 0,
} satisfies WorkspaceSession

const unreadPinnedSession = {
  ...workspaceSessionFixtures.unread,
  pinned: 1,
} satisfies WorkspaceSession

function WorkspaceSessionActionsMenuCatalog() {
  const [state, setState] = useState<MenuState>('standard')
  const [open, setOpen] = useState(true)
  const [anchor, setAnchor]
    = useState<WorkspaceSessionMenuAnchor | null>(null)
  const [lastAction, setLastAction] = useState('none')
  const standardRef = useRef<HTMLButtonElement>(null)
  const unreadPinnedRef = useRef<HTMLButtonElement>(null)
  const groupedRef = useRef<HTMLButtonElement>(null)
  const session = state === 'standard'
    ? standardSession
    : state === 'unreadPinned'
      ? unreadPinnedSession
      : groupedSession
  const activeRef = state === 'standard'
    ? standardRef
    : state === 'unreadPinned'
      ? unreadPinnedRef
      : groupedRef

  useLayoutEffect(() => {
    setAnchor(activeRef.current)
    setOpen(true)
  }, [activeRef])

  const chooseState = (nextState: MenuState) => {
    setState(nextState)
    setOpen(true)
  }
  const record = (action: string) => {
    setLastAction(action)
  }

  return (
    <main className="min-h-screen bg-muted/20 p-4 text-foreground sm:p-8">
      <section className="mx-auto flex w-full max-w-2xl flex-wrap items-center gap-2 border border-border bg-background p-4 shadow-sm">
        <Button
          ref={standardRef}
          variant={state === 'standard' ? 'default' : 'outline'}
          onClick={() => chooseState('standard')}
        >
          Standard
        </Button>
        <Button
          ref={unreadPinnedRef}
          variant={state === 'unreadPinned' ? 'default' : 'outline'}
          onClick={() => chooseState('unreadPinned')}
        >
          Unread and pinned
        </Button>
        <Button
          ref={groupedRef}
          variant={state === 'grouped' ? 'default' : 'outline'}
          onClick={() => chooseState('grouped')}
        >
          In group
        </Button>
        <output
          className="ml-auto text-xs text-muted-foreground"
          data-testid="workspace-session-menu-last-action"
        >
          {lastAction}
        </output>
      </section>
      <WorkspaceSessionActionsMenuView
        open={open}
        anchor={anchor}
        session={session}
        sessionGroups={Object.values(workspaceSessionGroupFixtures)}
        canOpenInNewWindow
        canCopySessionId
        onOpenChange={setOpen}
        onOpenInSurface={() => record('open-surface')}
        onOpenInNewWindow={() => record('open-window')}
        onRename={() => record('rename')}
        onRegenerateTitle={() => record('regenerate-title')}
        onToggleReadState={() => record('toggle-read')}
        onTogglePin={() => record('toggle-pin')}
        onCopyMarkdown={() => record('copy-markdown')}
        onExportZip={() => record('export-zip')}
        onCopySessionId={() => record('copy-session-id')}
        onArchive={() => record('archive')}
        onAddToGroup={groupId => record(`add:${groupId}`)}
        onRemoveFromGroup={() => record('remove-from-group')}
        onCreateGroup={() => record('create-group')}
      />
    </main>
  )
}

const meta = {
  title: 'App/Workspace/Session Actions Menu',
  component: WorkspaceSessionActionsMenuCatalog,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
  },
} satisfies Meta<typeof WorkspaceSessionActionsMenuCatalog>

export default meta
type Story = StoryObj<typeof meta>

export const States: Story = {}
