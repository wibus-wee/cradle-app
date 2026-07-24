import {
  FolderLine as FolderIcon,
  NewFolderLine as FolderPlusIcon,
} from '@mingcute/react'
import { useQueryClient } from '@tanstack/react-query'
import { useSearch } from '@tanstack/react-router'
import type { FileUIPart } from 'ai'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getWorksQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import { postWorks } from '~/api-gen/sdk.gen'
import type { PostWorksData } from '~/api-gen/types.gen'
import { useRegisterLayoutSlots } from '~/components/layout/use-layout-slots'
import { Button } from '~/components/ui/button'
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '~/components/ui/menu'
import type { DraftChatComposerSubmitOptions } from '~/features/chat/composer/draft-chat-composer'
import { DraftChatComposerWithState } from '~/features/chat/composer/draft-chat-composer'
import type { ChatContextPart } from '~/features/chat/context/chat-context-parts'
import { useComposerState } from '~/features/composer-toolbar'
import { trackProductTaskFinished, trackProductTaskStarted } from '~/features/product-analytics/client'
import { isLocalWorkspace } from '~/features/workspace/types'
import { sessionsQueryKey } from '~/features/workspace/use-session'
import { useAddWorkspace, useWorkspaces, WORKSPACES_QUERY_KEY } from '~/features/workspace/use-workspace'
import { apiErrorMessage } from '~/lib/api-error'
import { openWork, openWorkspaceDiffs } from '~/navigation/navigation-commands'
import { useSurfaceActive } from '~/navigation/surface-activity-context'

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

  const workspaceSelector = (
    <Menu>
      <MenuTrigger
        render={<Button variant="ghost" size="xs" className="text-foreground hover:text-foreground" />}
        data-testid="new-work-workspace-selector"
      >
        <FolderIcon className="size-3 shrink-0" />
        <span className="max-w-32 truncate">
          {selectedWorkspace?.name ?? t('new.workspace')}
        </span>
      </MenuTrigger>
      <MenuPopup>
        <MenuGroup>
          <MenuGroupLabel>{t('new.workspace')}</MenuGroupLabel>
          <MenuSeparator />
          {localWorkspaces.map(workspace => (
            <MenuItem
              key={workspace.id}
              onClick={() => setSelectedWorkspaceId(workspace.id)}
            >
              <FolderIcon className="size-3" />
              <span className="flex-1">{workspace.name}</span>
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem onClick={() => void addFromPicker()} disabled={adding}>
            <FolderPlusIcon className="size-3" />
            <span className="flex-1">
              {adding ? t('new.addingProject') : t('new.addProject')}
            </span>
          </MenuItem>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  )

  const dirty = isDirtySourceError(error)
  const remoteBaseUnavailable = isRemoteBaseUnavailableError(error)
  return (
    <div className="flex h-full flex-col bg-background" data-testid="new-work-page">
      <div className="flex flex-1 items-center justify-center px-6 pb-8">
        <div className="w-full max-w-160">
          <div className="mb-5 px-1">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{t('new.title')}</h1>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
              {t('new.description')}
            </p>
          </div>
          <DraftChatComposerWithState
            composerState={composerState}
            workspaceId={selectedWorkspace?.id ?? null}
            active={active}
            contextBar={workspaceSelector}
            onSend={handleSend}
            sendButtonText={t('new.start')}
            testIdPrefix="new-work"
          />
          {!loading && localWorkspaces.length === 0 && (
            <div className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              {t('new.noLocalWorkspace')}
            </div>
          )}
          {error !== null && (
            <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-3" data-testid="new-work-error">
              <div className="text-sm font-medium text-foreground">
                {dirty
                  ? t('new.dirtyTitle')
                  : remoteBaseUnavailable
                    ? t('new.remoteBaseUnavailableTitle')
                    : t('new.createFailed')}
              </div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                {dirty
                  ? t('new.dirtyDescription')
                  : remoteBaseUnavailable
                    ? t('new.remoteBaseUnavailableDescription')
                    : apiErrorMessage(error)}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {dirty && selectedWorkspace && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => openWorkspaceDiffs({ workspaceId: selectedWorkspace.id })}
                  >
                    {t('new.openChanges')}
                  </Button>
                )}
                {dirty && pendingObjective && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleStartFromRemoteDefault()}
                    data-testid="new-work-start-from-remote-default"
                  >
                    {t('new.startFromRemoteDefault')}
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant={dirty && pendingObjective ? 'outline' : 'default'}
                  onClick={() => {
                    setError(null)
                    setPendingObjective(null)
                  }}
                >
                  {t('new.tryAgain')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
