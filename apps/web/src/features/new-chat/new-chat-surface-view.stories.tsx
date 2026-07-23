import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { ComposerView } from '~/features/chat/composer/composer-view'

import type { NewChatQuickAction } from './new-chat-quick-actions-view'
import { NewChatQuickActionsView } from './new-chat-quick-actions-view'
import { NewChatRecentSessionsView } from './new-chat-recent-sessions-view'
import { NewChatSurfaceView } from './new-chat-surface-view'
import type { NewChatWorkspaceOption } from './new-chat-workspace-selector-view'
import { NewChatWorkspaceSelectorView } from './new-chat-workspace-selector-view'

const workspaceFixtures: NewChatWorkspaceOption[] = [
  { id: 'cradle-app', name: 'Cradle App' },
  { id: 'runtime-contracts', name: 'Runtime Contracts' },
  { id: 'plugin-sdk', name: 'Plugin SDK' },
]

const quickActionFixtures: NewChatQuickAction[] = [
  { id: 'explain', label: 'Explain code', prompt: 'Explain the selected code and its ownership.' },
  { id: 'risk', label: 'Find risks', prompt: 'Find the highest-risk behavior in this change.' },
  { id: 'tests', label: 'Fix tests', prompt: 'Diagnose and fix the failing tests.' },
  { id: 'notes', label: 'Write notes', prompt: 'Summarize the implementation decisions.' },
  { id: 'refactor', label: 'Refactor', prompt: 'Refactor this surface into a props-only View.' },
]

type NewChatStorySceneName = 'surface' | 'recent'

function NewChatStoryScene({
  scene,
  planMode,
}: {
  scene: NewChatStorySceneName
  planMode: boolean
}) {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>('cradle-app')
  const [draft, setDraft] = useState('')
  const [draftKey, setDraftKey] = useState(0)
  const selectedWorkspace = workspaceFixtures.find(workspace => workspace.id === selectedWorkspaceId) ?? null

  if (scene === 'recent') {
    return (
      <main className="min-h-[28rem] bg-background py-10 text-foreground">
        <NewChatRecentSessionsView
          title="Recent sessions"
          sessions={[
            { id: '1', title: 'Extract Storybook View seams', relativeTimeLabel: 'Just now' },
            { id: '2', title: 'Audit runtime tool surfaces', relativeTimeLabel: '18 minutes ago' },
            { id: '3', title: 'Review component architecture', relativeTimeLabel: 'Yesterday' },
          ]}
          onResume={sessionId => setDraft(`Resume session ${sessionId}`)}
        />
        <div className="mx-auto max-w-160 px-6 text-xs text-muted-foreground" role="status">{draft || 'No session selected'}</div>
      </main>
    )
  }

  const chooseQuickAction = (prompt: string) => {
    setDraft(prompt)
    setDraftKey((key) => {
      return key + 1
    })
  }

  return (
    <NewChatSurfaceView
      active
      ready
      planMode={planMode}
      composer={(
        <ComposerView
          send={{
            submit: (text) => {
              setDraft(`Sent: ${text}`)
              return true
            },
          }}
          attachments={{
            supportsAttachments: true,
            acceptsNativeFiles: false,
          }}
          slots={{
            contextBar: (
              <NewChatWorkspaceSelectorView
                selectedWorkspace={selectedWorkspace}
                workspaces={workspaceFixtures}
                groupLabel="Workspace"
                adhocLabel="Ad hoc chat"
                addProjectLabel="Add project"
                addingProjectLabel="Adding project..."
                onSelectWorkspace={setSelectedWorkspaceId}
                onAddProject={() => setDraft('Add project selected')}
              />
            ),
          }}
          externalSignals={{
            replaceText: draft,
            replaceTextKey: draftKey,
          }}
          view={{
            placeholder: planMode ? 'Describe what should be planned...' : 'What would you like to build?',
            textareaRows: 3,
          }}
        />
      )}
      quickActions={<NewChatQuickActionsView actions={quickActionFixtures} onSelect={chooseQuickAction} />}
    />
  )
}

const meta = {
  title: 'New Chat/NewChatSurfaceView',
  component: NewChatStoryScene,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
  },
  args: {
    scene: 'surface',
    planMode: false,
  },
} satisfies Meta<typeof NewChatStoryScene>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const PlanMode: Story = { args: { planMode: true } }
export const RecentSessions: Story = { args: { scene: 'recent' } }
