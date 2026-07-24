import {
  CheckLine as CheckIcon,
  CloseLine as XIcon,
  GitBranchLine as GitBranchIcon,
  PlusLine as PlusIcon,
  Refresh1Line as RefreshCwIcon,
} from '@mingcute/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useDeferredValue, useEffect, useReducer, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import {
  postWorkspacesByWorkspaceIdGitBranchesMutation,
  postWorkspacesByWorkspaceIdGitCheckoutMutation,
  postWorkspacesByWorkspaceIdGitFetchMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { toastManager } from '~/components/ui/toast'
import { cn } from '~/lib/cn'

import {
  gitBranchesQueryKey,
  gitGraphQueryKey,
  gitRepositoriesQueryKey,
  gitStatusQueryKey,
  useGitBranches,
} from './use-git'

interface BranchPickerProps {
  workspaceId: string
  repositoryPath?: string | null
  currentBranch: string
  children: React.ReactNode
}

interface BranchPickerState {
  open: boolean
  search: string
  fetching: boolean
  creating: boolean
  newName: string
  createError: string | null
  createLoading: boolean
}

type BranchPickerAction
  = | { type: 'set-open', open: boolean }
    | { type: 'set-search', search: string }
    | { type: 'set-fetching', fetching: boolean }
    | { type: 'start-creating' }
    | { type: 'cancel-creating' }
    | { type: 'set-new-name', newName: string }
    | { type: 'set-create-error', error: string | null }
    | { type: 'set-create-loading', loading: boolean }
    | { type: 'complete-create' }

const INITIAL_BRANCH_PICKER_STATE: BranchPickerState = {
  open: false,
  search: '',
  fetching: false,
  creating: false,
  newName: '',
  createError: null,
  createLoading: false,
}

function branchPickerReducer(state: BranchPickerState, action: BranchPickerAction): BranchPickerState {
  switch (action.type) {
    case 'set-open':
      return action.open
        ? { ...state, open: true }
        : { ...state, open: false, creating: false, newName: '', createError: null, createLoading: false }
    case 'set-search':
      return { ...state, search: action.search }
    case 'set-fetching':
      return { ...state, fetching: action.fetching }
    case 'start-creating':
      return { ...state, creating: true, newName: '', createError: null }
    case 'cancel-creating':
      return { ...state, creating: false, newName: '', createError: null, createLoading: false }
    case 'set-new-name':
      return { ...state, newName: action.newName }
    case 'set-create-error':
      return { ...state, createError: action.error }
    case 'set-create-loading':
      return { ...state, createLoading: action.loading }
    case 'complete-create':
      return { ...state, open: false, creating: false, newName: '', createError: null, createLoading: false }
    default:
      return state
  }
}

function cleanGitError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.split('\n').filter(line => line.trim() && !line.trim().startsWith('at ')).join('\n').trim()
}

function BranchPickerCreatePanel({
  createError,
  createLoading,
  currentBranch,
  newName,
  onCancel,
  onCreate,
  onNameChange,
  inputRef,
}: {
  createError: string | null
  createLoading: boolean
  currentBranch: string
  newName: string
  onCancel: () => void
  onCreate: () => void
  onNameChange: (value: string) => void
  inputRef: React.RefObject<HTMLInputElement | null>
}) {
  const { t } = useTranslation('git')

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
        <GitBranchIcon className="size-3.5 shrink-0 !text-muted-foreground/50" aria-hidden />
        <Input
          ref={inputRef}
          className="h-7 flex-1 text-xs font-mono"
          placeholder="feature/my-branch"
          value={newName}
          data-testid="git-branch-create-input"
          onChange={e => onNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              void onCreate()
            }
            if (e.key === 'Escape') {
              onCancel()
            }
          }}
          disabled={createLoading}
        />
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onCancel}
          className="shrink-0 text-muted-foreground"
          aria-label={t('branch.create.cancel')}
          data-testid="git-branch-create-cancel"
        >
          <XIcon className="size-3.5" aria-hidden="true" />
        </Button>
      </div>

      <div className="px-3 py-2">
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {t('branch.create.description', { branch: currentBranch })}
        </p>
        {createError && <p className="mt-1.5 text-[10px] text-destructive">{createError}</p>}
      </div>

      <div className="border-t border-border px-2 py-1.5">
        <button
          type="button"
          disabled={!newName.trim() || createLoading}
          onClick={() => { void onCreate() }}
          data-testid="git-branch-create-submit"
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
            newName.trim() && !createLoading
              ? 'cursor-pointer text-foreground hover:bg-accent/60'
              : 'cursor-not-allowed text-muted-foreground/40',
          )}
        >
          <PlusIcon className="size-3 shrink-0" aria-hidden />
          {createLoading
            ? t('branch.create.creating')
            : newName.trim()
              ? t('branch.create.named', { branch: newName.trim() })
              : t('branch.create.empty')}
        </button>
      </div>
    </div>
  )
}

function BranchPickerListPanel({
  currentBranch,
  fetching,
  localFiltered,
  remoteFiltered,
  search,
  searchInputRef,
  onCheckout,
  onFetch,
  onSearchChange,
  onStartCreating,
}: {
  currentBranch: string
  fetching: boolean
  localFiltered: Array<{ name: string }>
  remoteFiltered: Array<{ name: string }>
  search: string
  searchInputRef: React.RefObject<HTMLInputElement | null>
  onCheckout: (branch: string) => void
  onFetch: () => void
  onSearchChange: (value: string) => void
  onStartCreating: () => void
}) {
  const { t } = useTranslation('git')

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
        <Input
          ref={searchInputRef}
          className="h-7 text-xs"
          placeholder={t('branch.search.placeholder')}
          value={search}
          data-testid="git-branch-search"
          onChange={e => onSearchChange(e.target.value)}
        />
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('branch.fetch')}
          title={t('branch.fetch.title')}
          onClick={() => { void onFetch() }}
          disabled={fetching}
          className="shrink-0"
          data-testid="git-branch-fetch"
        >
          <RefreshCwIcon className={cn('size-3.5', fetching && 'animate-spin')} aria-hidden="true" />
        </Button>
      </div>

      <div className="max-h-64 overflow-y-auto py-1">
        {localFiltered.length > 0 && (
          <div>
            <p className="px-3 pb-1 pt-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {t('branch.local')}
            </p>
            {localFiltered.map(branch => (
              <button
                key={branch.name}
                type="button"
                onClick={() => { void onCheckout(branch.name) }}
                data-testid="git-branch-option"
                data-branch-scope="local"
                data-branch-name={branch.name}
                data-branch-current={branch.name === currentBranch ? 'true' : 'false'}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent/60"
              >
                <GitBranchIcon className="size-3 shrink-0 !text-muted-foreground/50" aria-hidden />
                <span className="flex-1 break-all font-mono">{branch.name}</span>
                {branch.name === currentBranch && <CheckIcon className="size-3 shrink-0 !text-primary" aria-hidden />}
              </button>
            ))}
          </div>
        )}

        {remoteFiltered.length > 0 && (
          <div>
            <p className="px-3 pb-1 pt-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {t('branch.remote')}
            </p>
            {remoteFiltered.map(branch => (
              <button
                key={branch.name}
                type="button"
                onClick={() => { void onCheckout(branch.name) }}
                data-testid="git-branch-option"
                data-branch-scope="remote"
                data-branch-name={branch.name}
                data-branch-current="false"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent/60"
              >
                <GitBranchIcon className="size-3 shrink-0 !text-muted-foreground/30" aria-hidden />
                <span className="flex-1 break-all font-mono text-muted-foreground">{branch.name}</span>
              </button>
            ))}
          </div>
        )}

        {localFiltered.length === 0 && remoteFiltered.length === 0 && (
          <p className="p-3 text-center text-xs text-muted-foreground">
            {search ? t('branch.noMatches') : t('branch.loading')}
          </p>
        )}
      </div>

      <div className="border-t border-border px-2 py-1.5">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          onClick={onStartCreating}
          data-testid="git-branch-start-create"
        >
          <PlusIcon className="size-3 shrink-0" aria-hidden />
          {t('branch.new')}
        </button>
      </div>
    </div>
  )
}

export function BranchPicker({
  workspaceId,
  repositoryPath,
  currentBranch,
  children,
}: BranchPickerProps) {
  const { t } = useTranslation('git')
  const [state, dispatch] = useReducer(branchPickerReducer, INITIAL_BRANCH_PICKER_STATE)
  const createInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const queryClient = useQueryClient()
  const { data: branches } = useGitBranches(workspaceId, repositoryPath)
  const repositoryQuery = repositoryPath ? { query: { repo: repositoryPath } } : {}
  const repositoryBody = repositoryPath ? { repo: repositoryPath } : {}

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: gitRepositoriesQueryKey({ path: { workspaceId } }) })
    void queryClient.invalidateQueries({ queryKey: gitStatusQueryKey({ path: { workspaceId }, ...repositoryQuery }) })
    void queryClient.invalidateQueries({ queryKey: gitBranchesQueryKey({ path: { workspaceId }, ...repositoryQuery }) })
    // Omit query.limit to fuzzy-match all limit variants for this workspace
    void queryClient.invalidateQueries({ queryKey: gitGraphQueryKey({ path: { workspaceId }, ...repositoryQuery }) })
  }

  const checkoutMutation = useMutation({
    ...postWorkspacesByWorkspaceIdGitCheckoutMutation(),
    onSuccess: () => invalidateAll(),
  })

  const fetchMutation = useMutation({
    ...postWorkspacesByWorkspaceIdGitFetchMutation(),
    onSuccess: () => invalidateAll(),
  })

  const createBranchMutation = useMutation({
    ...postWorkspacesByWorkspaceIdGitBranchesMutation(),
    onSuccess: () => invalidateAll(),
  })

  const handleCheckout = async (branch: string) => {
    dispatch({ type: 'set-open', open: false })
    try {
      await checkoutMutation.mutateAsync({
        path: { workspaceId },
        body: { ...repositoryBody, branch },
      })
    }
    catch (err) {
      toastManager.add({ type: 'error', title: t('branch.checkout.error'), description: cleanGitError(err) })
    }
  }

  const handleFetch = async () => {
    dispatch({ type: 'set-fetching', fetching: true })
    try {
      await fetchMutation.mutateAsync({ path: { workspaceId }, body: repositoryBody })
    }
    finally {
      dispatch({ type: 'set-fetching', fetching: false })
    }
  }

  const startCreating = () => {
    dispatch({ type: 'start-creating' })
  }

  const cancelCreating = () => {
    dispatch({ type: 'cancel-creating' })
  }

  const handleCreate = async () => {
    const name = state.newName.trim()
    if (!name) {
      return
    }
    dispatch({ type: 'set-create-loading', loading: true })
    dispatch({ type: 'set-create-error', error: null })
    try {
      await createBranchMutation.mutateAsync({
        path: { workspaceId },
        body: { ...repositoryBody, name },
      })
      dispatch({ type: 'complete-create' })
    }
    catch (err) {
      dispatch({ type: 'set-create-error', error: cleanGitError(err) || t('branchPicker.creationFailed') })
    }
    finally {
      dispatch({ type: 'set-create-loading', loading: false })
    }
  }

  useEffect(() => {
    if (!state.open) {
      return
    }
    requestAnimationFrame(() => {
      if (state.creating) {
        createInputRef.current?.focus()
      }
      else {
        searchInputRef.current?.focus()
      }
    })
  }, [state.creating, state.open])

  const q = state.search.toLowerCase()
  const deferredQ = useDeferredValue(q)
  const localFiltered = (branches?.local ?? []).filter(b => b.name.toLowerCase().includes(deferredQ))
  const remoteFiltered = (branches?.remote ?? []).filter(b => b.name.toLowerCase().includes(deferredQ))

  return (
    <Popover
      open={state.open}
      onOpenChange={(nextOpen) => {
        dispatch({ type: 'set-open', open: nextOpen })
      }}
    >
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>
      <PopoverContent
        className="w-72 gap-0 p-0"
        side="bottom"
        align="start"
        sideOffset={6}
        data-testid="git-branch-picker"
      >
        {state.creating
          ? (
            <BranchPickerCreatePanel
              createError={state.createError}
              createLoading={state.createLoading}
              currentBranch={currentBranch}
              newName={state.newName}
              onCancel={cancelCreating}
              onCreate={handleCreate}
              onNameChange={(value) => {
                dispatch({ type: 'set-new-name', newName: value })
                if (state.createError) {
                  dispatch({ type: 'set-create-error', error: null })
                }
              }}
              inputRef={createInputRef}
            />
          )
          : (
            <BranchPickerListPanel
              currentBranch={currentBranch}
              fetching={state.fetching}
              localFiltered={localFiltered}
              remoteFiltered={remoteFiltered}
              search={state.search}
              searchInputRef={searchInputRef}
              onCheckout={handleCheckout}
              onFetch={handleFetch}
              onSearchChange={value => dispatch({ type: 'set-search', search: value })}
              onStartCreating={startCreating}
            />
          )}
      </PopoverContent>
    </Popover>
  )
}
