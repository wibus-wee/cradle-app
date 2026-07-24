import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { Badge } from '~/components/ui/badge'
import type { ComposerProps } from '~/features/chat/composer/views/composer-view'
import { ComposerView } from '~/features/chat/composer/views/composer-view'

import { newWorkWorkspaceFixtures } from './fixtures/new-work'
import type { NewWorkFailureKind } from './new-work-error-view'
import { NewWorkPageView } from './new-work-page-view'
import { NewWorkWorkspaceSelectorView } from './new-work-workspace-selector-view'

type NewWorkStoryState
  = | 'ready'
    | 'adding-workspace'
    | 'workspace-menu-open'
    | 'loading-workspaces'
    | 'no-local-workspace'
    | 'dirty-source'
    | 'remote-base-unavailable'
    | 'create-failed'

function failureForState(
  state: NewWorkStoryState,
): NewWorkFailureKind | null {
  if (state === 'dirty-source') {
    return 'dirty-source'
  }
  if (state === 'remote-base-unavailable') {
    return 'remote-base-unavailable'
  }
  if (state === 'create-failed') {
    return 'generic'
  }
  return null
}

function NewWorkPageStoryScene({ state }: { state: NewWorkStoryState }) {
  const withoutWorkspaces = state === 'loading-workspaces'
    || state === 'no-local-workspace'
  const workspaces = withoutWorkspaces ? [] : newWorkWorkspaceFixtures
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    workspaces[0]?.id ?? null,
  )
  const [failureDismissed, setFailureDismissed] = useState(false)
  const [activity, setActivity] = useState('Ready to create Work')
  const failureKind = failureDismissed ? null : failureForState(state)
  const workspaceSelector = (
    <NewWorkWorkspaceSelectorView
      workspaces={workspaces}
      selectedWorkspaceId={selectedWorkspaceId}
      adding={state === 'adding-workspace'}
      defaultOpen={state === 'workspace-menu-open'}
      onSelectWorkspace={setSelectedWorkspaceId}
      onAddWorkspace={() => setActivity('Add project selected')}
    />
  )
  const composerProps: ComposerProps = {
    send: {
      submit: (text) => {
        setActivity(text.trim() ? 'Work creation requested' : 'Objective required')
        return true
      },
      label: 'Start Work',
      isSending: false,
      sendDisabled: workspaces.length === 0,
    },
    attachments: {
      supportsAttachments: true,
      acceptsNativeFiles: false,
    },
    slots: {
      toolbar: (
        <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <Badge variant="secondary">Codex</Badge>
          <span>GPT-5.4</span>
        </div>
      ),
      contextBar: workspaceSelector,
      footer: <span className="text-[11px] text-muted-foreground">Managed Worktree</span>,
    },
    externalSignals: {
      replaceText: state === 'no-local-workspace' || state === 'loading-workspaces'
        ? ''
        : 'Refactor the remaining user-visible surfaces into fixture-driven Views.',
      replaceTextKey: 1,
    },
    view: {
      placeholder: 'Describe a concrete outcome for the agent...',
      textareaRows: 4,
    },
    testIds: {
      textarea: 'new-work-textarea',
      sendButton: 'new-work-send',
    },
    accessibility: {
      textareaAriaLabel: 'Work objective',
      sendButtonAriaLabel: 'Start Work',
    },
  }

  return (
    <main className="h-screen min-h-160 bg-muted/20 text-foreground">
      <NewWorkPageView
        composer={<ComposerView {...composerProps} />}
        workspaceCount={workspaces.length}
        loadingWorkspaces={state === 'loading-workspaces'}
        failureKind={failureKind}
        failureMessage={
          failureKind === 'generic'
            ? 'The server rejected the Work request. Review the selected runtime and try again.'
            : null
        }
        canOpenChanges={failureKind === 'dirty-source'}
        canStartFromRemoteDefault={failureKind === 'dirty-source'}
        onOpenChanges={() => setActivity('Open Changes selected')}
        onStartFromRemoteDefault={() => setActivity('Remote default selected')}
        onDismissFailure={() => setFailureDismissed(true)}
      />
      <span className="sr-only" role="status">{activity}</span>
    </main>
  )
}

const meta = {
  title: 'App/New Work/Page',
  component: NewWorkPageStoryScene,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
  },
  args: {
    state: 'ready',
  },
} satisfies Meta<typeof NewWorkPageStoryScene>

export default meta

type Story = StoryObj<typeof meta>

export const Ready: Story = {}

export const AddingWorkspace: Story = {
  args: { state: 'adding-workspace' },
}

export const WorkspaceMenuOpen: Story = {
  args: { state: 'workspace-menu-open' },
}

export const LoadingWorkspaces: Story = {
  args: { state: 'loading-workspaces' },
}

export const NoLocalWorkspace: Story = {
  args: { state: 'no-local-workspace' },
}

export const DirtySource: Story = {
  args: { state: 'dirty-source' },
}

export const RemoteBaseUnavailable: Story = {
  args: { state: 'remote-base-unavailable' },
}

export const CreateFailed: Story = {
  args: { state: 'create-failed' },
}
