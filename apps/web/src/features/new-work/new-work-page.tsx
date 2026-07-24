import { useQueryClient } from '@tanstack/react-query'
import { useSearch } from '@tanstack/react-router'
import type { FileUIPart } from 'ai'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getWorksQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import { postWorks } from '~/api-gen/sdk.gen'
import type { PostWorksData } from '~/api-gen/types.gen'
import { useRegisterLayoutSlots } from '~/components/layout/use-layout-slots'
import type { DraftChatComposerSubmitOptions } from '~/features/chat/composer/containers/draft-chat-composer-container'
import { DraftChatComposerWithState } from '~/features/chat/composer/containers/draft-chat-composer-container'
import type { ChatContextPart } from '~/features/chat/context/chat-context-parts'
import { useComposerState } from '~/features/composer-toolbar'
import { trackProductTaskFinished, trackProductTaskStarted } from '~/features/product-analytics/client'
import { isLocalWorkspace } from '~/features/workspace/types'
import { sessionsQueryKey } from '~/features/workspace/use-session'
import { useAddWorkspace, useWorkspaces, WORKSPACES_QUERY_KEY } from '~/features/workspace/use-workspace'
import { apiErrorMessage } from '~/lib/api-error'
import { openWork, openWorkspaceDiffs } from '~/navigation/navigation-commands'
import { useSurfaceActive } from '~/navigation/surface-activity-context'

import type { NewWorkFailureKind } from './new-work-error-view'
import { NewWorkPageView } from './new-work-page-view'
import { NewWorkWorkspaceSelectorView } from './new-work-workspace-selector-view'

type WorkBaseStrategy = NonNullable<PostWorksData['body']['baseStrategy']>

function isDirtySourceError(error: unknown): boolean {
  return !!error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === 'work_source_dirty'
}

function isRemoteBaseUnavailableError(error: unknown): boolean {
  return !!error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === 'work_remote_base_unavailable'
}

export function NewWorkPage() {
  const { t } = useTranslation('work')
  const active = useSurfaceActive()
  const search = useSearch({ from: '/work/new' })
  const queryClient = useQueryClient()
  const { workspaces, loading } = useWorkspaces()
  const { addFromPicker, adding } = useAddWorkspace()
  const localWorkspaces = useMemo(
    () => workspaces.filter(isLocalWorkspace),
    [workspaces],
  )
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(() => {
    if (search.workspaceId) {
      return search.workspaceId
    }
    try {
      return localStorage.getItem('cradle:lastWorkspaceId')
    }
    catch {
      return null
    }
  })
  const [error, setError] = useState<unknown>(null)
  const [pendingObjective, setPendingObjective] = useState<{
    text: string
    files: FileUIPart[]
    contextParts: ChatContextPart[]
    options: DraftChatComposerSubmitOptions
  } | null>(null)
  const selectedWorkspace = localWorkspaces.find(workspace => workspace.id === selectedWorkspaceId) ?? null
  const composerState = useComposerState({
    context: 'new-chat',
    workspaceId: selectedWorkspace?.id ?? null,
    enableAgents: true,
  })

  useEffect(() => {
    if (selectedWorkspaceId && !localWorkspaces.some(workspace => workspace.id === selectedWorkspaceId)) {
      setSelectedWorkspaceId(localWorkspaces[0]?.id ?? null)
    }
  }, [localWorkspaces, selectedWorkspaceId])

  useEffect(() => {
    try {
      if (selectedWorkspaceId) {
        localStorage.setItem('cradle:lastWorkspaceId', selectedWorkspaceId)
      }
    }
    catch {}
  }, [selectedWorkspaceId])

  useRegisterLayoutSlots('new-work', useMemo(() => ({
    asideWorkspaceId: selectedWorkspace?.id ?? null,
    hasAside: !!selectedWorkspace,
    hasBrowserPanel: !!selectedWorkspace,
  }), [selectedWorkspace]))

  const createWork = async (
    text: string,
    files: FileUIPart[],
    contextParts: ChatContextPart[],
    options: DraftChatComposerSubmitOptions,
    baseStrategy?: WorkBaseStrategy,
  ) => {
    if (!selectedWorkspace) {
      setError(new Error(t('new.workspaceRequired')))
      return false
    }
    if (
      !options.agentId
      && !options.providerTargetId
      && options.providerBinding !== 'runtime-owned'
    ) {
      return false
    }

    const goal = text.trim()
    const title = goal.slice(0, 80)
      || options.agentName
      || options.providerTargetName
      || t('surface.work')
    const body: PostWorksData['body'] = {
      workspaceId: selectedWorkspace.id,
      title,
      goal,
      linkedIssueId: search.issueId,
      runtimeKind: options.runtimeKind,
      runtimeSettings: options.runtimeSettings,
      thinkingEffort: options.thinkingEffort,
      ...(baseStrategy ? { baseStrategy } : {}),
      ...(options.agentId
        ? { agentId: options.agentId }
        : {
            providerTargetId: options.providerTargetId,
            modelId: options.modelId ?? null,
          }),
    }

    setError(null)
    const analyticsTask = trackProductTaskStarted({
      feature_domain: 'work',
      task_kind: 'work_create',
      task_variant: search.issueId ? 'issue' : 'new_work',
    })
    let result: Awaited<ReturnType<typeof postWorks>>
    try {
      result = await postWorks({ body })
    }
    catch (requestError) {
      trackProductTaskFinished(analyticsTask, 'failed')
      throw requestError
    }
    if (result.error || !result.data) {
      trackProductTaskFinished(analyticsTask, 'failed')
      setError(result.error ?? new Error(t('new.createFailed')))
      if (isDirtySourceError(result.error) || isRemoteBaseUnavailableError(result.error)) {
        setPendingObjective({ text, files, contextParts, options })
      }
      return false
    }

    const detail = result.data
    trackProductTaskFinished(analyticsTask, 'success')
    setPendingObjective(null)
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: getWorksQueryKey() }),
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey(selectedWorkspace.id) }),
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
    ])
    openWork(detail.work.id, { replace: true })
    return true
  }

  const handleSend = async (
    text: string,
    files: FileUIPart[],
    contextParts: ChatContextPart[],
    options: DraftChatComposerSubmitOptions,
  ) => {
    try {
      return await createWork(text, files, contextParts, options)
    }
    catch (requestError) {
      setError(requestError)
      if (isDirtySourceError(requestError) || isRemoteBaseUnavailableError(requestError)) {
        setPendingObjective({ text, files, contextParts, options })
      }
      return false
    }
  }

  const handleStartFromRemoteDefault = async () => {
    if (!pendingObjective) {
      return
    }
    try {
      await createWork(
        pendingObjective.text,
        pendingObjective.files,
        pendingObjective.contextParts,
        pendingObjective.options,
        'remote-default',
      )
    }
    catch (requestError) {
      setError(requestError)
      if (isDirtySourceError(requestError) || isRemoteBaseUnavailableError(requestError)) {
        setPendingObjective(pendingObjective)
      }
    }
  }

  const dirty = isDirtySourceError(error)
  const remoteBaseUnavailable = isRemoteBaseUnavailableError(error)
  const failureKind: NewWorkFailureKind | null = error === null
    ? null
    : dirty
      ? 'dirty-source'
      : remoteBaseUnavailable
        ? 'remote-base-unavailable'
        : 'generic'
  const workspaceSelector = (
    <NewWorkWorkspaceSelectorView
      workspaces={localWorkspaces}
      selectedWorkspaceId={selectedWorkspaceId}
      adding={adding}
      onSelectWorkspace={setSelectedWorkspaceId}
      onAddWorkspace={() => void addFromPicker()}
    />
  )
  const composer = (
    <DraftChatComposerWithState
      composerState={composerState}
      workspaceId={selectedWorkspace?.id ?? null}
      active={active}
      contextBar={workspaceSelector}
      onSend={handleSend}
      sendButtonText={t('new.start')}
      testIdPrefix="new-work"
    />
  )

  return (
    <NewWorkPageView
      composer={composer}
      workspaceCount={localWorkspaces.length}
      loadingWorkspaces={loading}
      failureKind={failureKind}
      failureMessage={failureKind === 'generic' ? apiErrorMessage(error) : null}
      canOpenChanges={dirty && selectedWorkspace !== null}
      canStartFromRemoteDefault={dirty && pendingObjective !== null}
      onOpenChanges={() => {
        if (selectedWorkspace) {
          openWorkspaceDiffs({ workspaceId: selectedWorkspace.id })
        }
      }}
      onStartFromRemoteDefault={() => void handleStartFromRemoteDefault()}
      onDismissFailure={() => {
        setError(null)
        setPendingObjective(null)
      }}
    />
  )
}
