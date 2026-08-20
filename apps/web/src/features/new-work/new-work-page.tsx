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
import { useGitBranches } from '~/features/git/shared/use-git'
import { trackProductTaskFinished, trackProductTaskStarted } from '~/features/product-analytics/client'
import { isLocalWorkspace, isWorkEligibleWorkspace } from '~/features/workspace/types'
import { sessionsQueryKey } from '~/features/workspace/use-session'
import { useAddWorkspace, useWorkspaces, WORKSPACES_QUERY_KEY } from '~/features/workspace/use-workspace'
import { apiErrorMessage } from '~/lib/api-error'
import { openWork, openWorkspaceDiffs } from '~/navigation/navigation-commands'
import { useSurfaceActive } from '~/navigation/surface-activity-context'

import { NewWorkAcceptanceCriteriaView } from './new-work-acceptance-criteria-view'
import { NewWorkBaseBranchControlView } from './new-work-base-branch-control-view'
import type { NewWorkFailureKind } from './new-work-error-view'
import { NewWorkPageView } from './new-work-page-view'
import { NewWorkWorkspaceSelectorView } from './new-work-workspace-selector-view'

function isDirtySourceError(error: unknown): boolean {
  return !!error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === 'work_source_dirty'
}

export function NewWorkPage() {
  const { t } = useTranslation('work')
  const active = useSurfaceActive()
  const search = useSearch({ from: '/work/new' })
  const queryClient = useQueryClient()
  const { workspaces, loading } = useWorkspaces()
  const { addFromPicker, adding } = useAddWorkspace()
  const localWorkspaces = useMemo(
    () => workspaces.filter(isWorkEligibleWorkspace),
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
  const selectedWorkspace = localWorkspaces.find(workspace => workspace.id === selectedWorkspaceId) ?? null
  const nodeId = selectedWorkspace && !isLocalWorkspace(selectedWorkspace)
    ? selectedWorkspace.locator.nodeId
    : null
  const selectedLocalWorkspaceId = selectedWorkspace && isLocalWorkspace(selectedWorkspace)
    ? selectedWorkspace.id
    : null
  const { data: branches, isLoading: branchesLoading } = useGitBranches(selectedLocalWorkspaceId)
  const [selectedBaseBranch, setSelectedBaseBranch] = useState<string | null>(null)
  const [acceptanceCriteriaText, setAcceptanceCriteriaText] = useState('')
  const composerState = useComposerState({
    context: 'new-chat',
    workspaceId: selectedWorkspace?.id ?? null,
    nodeId,
    enableAgents: !nodeId,
  })

  useEffect(() => {
    if (selectedWorkspaceId && !localWorkspaces.some(workspace => workspace.id === selectedWorkspaceId)) {
      setSelectedWorkspaceId(localWorkspaces[0]?.id ?? null)
    }
  }, [localWorkspaces, selectedWorkspaceId])

  useEffect(() => {
    setSelectedBaseBranch(null)
  }, [selectedWorkspaceId])

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
    baseBranch?: string | null,
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
      acceptanceCriteria: acceptanceCriteriaText
        .split('\n')
        .map(criterion => criterion.trim())
        .filter(Boolean),
      linkedIssueId: search.issueId,
      runtimeKind: options.runtimeKind,
      runtimeSettings: options.runtimeSettings,
      thinkingEffort: options.thinkingEffort,
      ...(baseBranch ? { baseBranch } : {}),
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
      return false
    }

    const detail = result.data
    trackProductTaskFinished(analyticsTask, 'success')
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
      return await createWork(text, files, contextParts, options, selectedBaseBranch)
    }
    catch (requestError) {
      setError(requestError)
      return false
    }
  }

  const dirty = isDirtySourceError(error)
  const failureKind: NewWorkFailureKind | null = error === null
    ? null
    : dirty
      ? 'dirty-source'
      : 'generic'
  const workspaceSelector = (
    <div className="flex min-w-0 items-center gap-1.5">
      <NewWorkWorkspaceSelectorView
        workspaces={localWorkspaces}
        selectedWorkspaceId={selectedWorkspaceId}
        adding={adding}
        onSelectWorkspace={setSelectedWorkspaceId}
        onAddWorkspace={() => void addFromPicker()}
      />
      {selectedWorkspace && isLocalWorkspace(selectedWorkspace)
        ? (
            <NewWorkBaseBranchControlView
              currentBranch={selectedWorkspace.gitIdentity?.branch ?? null}
              selectedBranch={selectedBaseBranch}
              branches={[
                ...(branches?.local ?? []).map(branch => ({
                  name: branch.name,
                  scope: 'local' as const,
                })),
                ...(branches?.remote ?? []).map(branch => ({
                  name: branch.name,
                  scope: 'remote' as const,
                })),
              ]}
              loading={branchesLoading}
              onSelectBranch={setSelectedBaseBranch}
            />
          )
        : null}
    </div>
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
      acceptanceCriteria={(
        <NewWorkAcceptanceCriteriaView
          value={acceptanceCriteriaText}
          onChange={setAcceptanceCriteriaText}
        />
      )}
      composer={composer}
      workspaceCount={localWorkspaces.length}
      loadingWorkspaces={loading}
      failureKind={failureKind}
      failureMessage={failureKind === 'generic' ? apiErrorMessage(error) : null}
      canOpenChanges={dirty && selectedWorkspace !== null}
      onOpenChanges={() => {
        if (selectedWorkspace) {
          openWorkspaceDiffs({ workspaceId: selectedWorkspace.id })
        }
      }}
      onDismissFailure={() => {
        setError(null)
      }}
    />
  )
}
