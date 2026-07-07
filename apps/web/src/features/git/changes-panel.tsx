// Renders workspace Git changes in the right-aside Changes tab.
import {
  GitBranchLine as GitBranchIcon,
  GitCompareLine as FileDiffIcon,
  Scan2Line as ScanEyeIcon,
} from '@mingcute/react'
import { prepareFileTreeInput } from '@pierre/trees'
import { FileTree as PierreFileTree, useFileTree } from '@pierre/trees/react'
import { useQueryClient } from '@tanstack/react-query'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getWorkspacesByWorkspaceIdGitRepositoriesQueryKey,
  getWorkspacesByWorkspaceIdGitStatusQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import { WorkspaceFileIcon, WorkspaceFileIconSpriteSheet } from '~/components/common/workspace-file-icon'
import { Spinner } from '~/components/ui/spinner'
import { toastManager } from '~/components/ui/toast'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import type { GitFileStatus, GitRepository } from '~/features/git/types'
import {
  CreateWorkspaceFileDialog,
  createWorkspaceFileEntry,
  getWorkspaceFileDefaultView,
  joinWorkspacePath,
  renameWorkspaceFilePath,
  WorkspaceFileContextMenu,
} from '~/features/workspace/workspace-file-menu'
import {
  isCopyPathChordStart,
  isCopyPathShortcut,
  isCopyRelativePathShortcut,
  WORKSPACE_FILE_SHORTCUT_SCOPE_ATTRIBUTE,
} from '~/features/workspace/workspace-file-shortcuts'
import { cn } from '~/lib/cn'
import { isElectron, nativeIpc, platform } from '~/lib/electron'
import { openWorkspaceDiffs } from '~/navigation/navigation-commands'
import { useBrowserPanelStore } from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'

import type { ChangeSection } from './changes-grouping'
import { groupGitFileStatuses } from './changes-grouping'
import { resolveTreeItemFromEvent } from './tree-event-target'
import { useGitRepositories } from './use-git'

type ChangesViewMode = 'type' | 'tree'

function formatErrorDescription(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface ChangesPanelProps {
  workspaceId: string | null | undefined
  workspacePath?: string | null
  sessionId?: string | null
}

export function ChangesPanel({ workspaceId, workspacePath, sessionId }: ChangesPanelProps) {
  const [viewMode, setViewMode] = useState<ChangesViewMode>('type')
  const { data: repositories, isLoading, isError, isSuccess } = useGitRepositories(workspaceId, sessionId)
  const gitRepositories = repositories ?? []
  const changedFileCount = gitRepositories.reduce((total, repository) => total + repository.files.length, 0)
  const openWorkspaceDiffTab = useBrowserPanelStore(state => state.openWorkspaceDiffTab)
  const requestScrollToFilePath = useBrowserPanelStore(state => state.requestScrollToFilePath)
  const setBrowserPanelOpen = useLayoutStore(state => state.setBrowserPanelOpen)
  const handleReviewRepository = (repository: GitRepository) => {
    if (!workspaceId) {
      return
    }
    openWorkspaceDiffs({ workspaceId, repositoryPath: repository.path })
  }

  const handlePreviewFile = (repository: GitRepository, path: string) => {
    if (!workspaceId) {
      return
    }
    const tabId = openWorkspaceDiffTab({
      workspaceId,
      repositoryPath: getWorkspaceDiffRepositoryPath(repository.path, gitRepositories.length),
      title: 'All Changes',
    })
    setBrowserPanelOpen(true)
    requestScrollToFilePath({ path, tabId })
  }

  let changesContent: ReactNode = null
  if (gitRepositories.length === 0) {
    changesContent = (
      <div
        className="flex flex-1 items-center justify-center p-4 text-center"
        data-testid="changes-panel-empty"
      >
        <p className="text-xs text-muted-foreground">No Git repositories found</p>
      </div>
    )
  }
  else if (changedFileCount === 0) {
    changesContent = (
      <div
        className="flex flex-1 items-center justify-center p-4 text-center"
        data-testid="changes-panel-empty"
      >
        <p className="text-xs text-muted-foreground">No working tree changes</p>
      </div>
    )
  }
  else if (gitRepositories.length === 1) {
    const repository = gitRepositories[0]!
    changesContent = viewMode === 'tree'
      ? (
        <ChangesTreeView
          files={repository.files}
          repositoryPath={repository.path}
          workspaceId={workspaceId}
          workspacePath={workspacePath ?? undefined}
          onFileClick={path => handlePreviewFile(repository, path)}
        />
      )
      : (
        <ChangesTypeView
          sections={groupGitFileStatuses(repository.files)}
          onFileClick={path => handlePreviewFile(repository, path)}
        />
      )
  }
  else {
    changesContent = (
      <ChangesRepositoryList
        repositories={gitRepositories}
        viewMode={viewMode}
        workspaceId={workspaceId}
        workspacePath={workspacePath ?? undefined}
        onFileClick={handlePreviewFile}
        onReviewRepository={handleReviewRepository}
      />
    )
  }

  if (!workspaceId) {
    return (
      <div
        className="flex flex-1 items-center justify-center p-4 text-center"
        data-testid="changes-panel-empty-workspace"
      >
        <p className="text-xs text-muted-foreground">Select a workspace first</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center" data-testid="changes-panel-loading">
        <Spinner className="size-4 !text-muted-foreground/40" aria-hidden />
      </div>
    )
  }

  if (isError) {
    return (
      <div
        className="flex flex-1 items-center justify-center p-4 text-center"
        data-testid="changes-panel-error"
      >
        <div className="flex flex-col items-center gap-2">
          <FileDiffIcon className="size-5 !text-muted-foreground/30" aria-hidden />
          <p className="text-xs text-muted-foreground">Git changes unavailable</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden"
      data-testid="changes-panel"
      data-right-aside-changes-ready={isSuccess ? 'true' : 'false'}
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2.5">
        <FileDiffIcon className="size-3.5 shrink-0 !text-muted-foreground/60" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/80">
          Changes
        </span>
        <span
          className="shrink-0 text-[10px] tabular-nums text-muted-foreground/55"
          data-testid="changes-panel-count"
        >
          {changedFileCount}
        </span>
        {changedFileCount > 0 && gitRepositories.length === 1 && (
          <button
            type="button"
            onClick={() => handleReviewRepository(gitRepositories[0]!)}
            className="flex h-5 items-center gap-1 rounded px-1.5 text-[10px] font-medium text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
            data-testid="changes-review-all"
          >
            <ScanEyeIcon className="size-3" aria-hidden />
            Review
          </button>
        )}
        <ToggleGroup
          type="single"
          value={viewMode}
          onValueChange={(value) => {
            if (value === 'type' || value === 'tree') {
              setViewMode(value)
            }
          }}
          variant="outline"
          size="sm"
          className="h-5 shrink-0 gap-px rounded-md"
          aria-label="Changes view mode"
          data-testid="changes-view-mode"
        >
          <ToggleGroupItem
            value="type"
            aria-label="Show changes by type"
            className="h-5 px-1.5 text-[10px]"
          >
            Type
          </ToggleGroupItem>
          <ToggleGroupItem
            value="tree"
            aria-label="Show changes as tree"
            className="h-5 px-1.5 text-[10px]"
          >
            Tree
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {changesContent}
    </div>
  )
}

function ChangesRepositoryList({
  repositories,
  viewMode,
  workspaceId,
  workspacePath,
  onFileClick,
  onReviewRepository,
}: {
  repositories: GitRepository[]
  viewMode: ChangesViewMode
  workspaceId: string | null | undefined
  workspacePath?: string
  onFileClick: (repository: GitRepository, path: string) => void
  onReviewRepository: (repository: GitRepository) => void
}) {
  const changedRepositories = repositories.filter(repository => repository.files.length > 0)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-2" data-testid="changes-panel-repositories">
      {changedRepositories.map(repository => (
        <section
          key={repository.path}
          className="px-2 pb-3 last:pb-1"
          data-testid="changes-repository-section"
        >
          <div className="mb-1 flex h-7 min-w-0 items-center gap-2 px-1">
            <GitBranchIcon className="size-3.5 shrink-0 !text-muted-foreground/50" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 truncate text-xs font-medium text-foreground/85">
                  {repository.name}
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/55">
                  {repository.files.length}
                </span>
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground/50">
                <span className="min-w-0 truncate">{repository.branch}</span>
                {repository.path !== '.' && (
                  <span className="min-w-0 truncate">{repository.path}</span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onReviewRepository(repository)}
              className="flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[10px] font-medium text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
              data-testid="changes-repository-review"
            >
              <ScanEyeIcon className="size-3" aria-hidden />
              Review
            </button>
          </div>
          <div className="min-h-0 overflow-hidden rounded-md border border-border/35 bg-background/30">
            {viewMode === 'tree'
              ? (
                <div className="h-64 min-h-0">
                  <ChangesTreeView
                    files={repository.files}
                    repositoryPath={repository.path}
                    workspaceId={workspaceId}
                    workspacePath={workspacePath}
                    onFileClick={path => onFileClick(repository, path)}
                  />
                </div>
              )
              : (
                <ChangesTypeView
                  sections={groupGitFileStatuses(repository.files)}
                  onFileClick={path => onFileClick(repository, path)}
                />
              )}
          </div>
        </section>
      ))}
    </div>
  )
}

function ChangesTypeView({
  sections,
  onFileClick,
}: {
  sections: ChangeSection[]
  onFileClick: (path: string) => void
}) {
  return (
    <div
      className="relative min-h-0 flex-1 overflow-y-auto py-2"
      data-testid="changes-panel-sections"
    >
      <WorkspaceFileIconSpriteSheet />
      {sections
        .filter(section => section.files.length > 0)
        .map(section => (
          <ChangeSectionView key={section.id} section={section} onFileClick={onFileClick} />
        ))}
    </div>
  )
}

function ChangeSectionView({
  section,
  onFileClick,
}: {
  section: ChangeSection
  onFileClick: (path: string) => void
}) {
  return (
    <section
      className="px-2 pb-3 last:pb-1"
      data-testid={`changes-section-${section.id}`}
      aria-label={section.label}
    >
      <div className="mb-1 flex h-5 items-center gap-2 px-1">
        <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-normal text-muted-foreground/70">
          {section.label}
        </span>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/45">
          {section.files.length}
        </span>
      </div>
      <menu
        className="overflow-hidden rounded-md border border-border/35 bg-background/30"
      >
        {section.files.map(file => (
          <ChangeFileRow key={file.path} file={file} onClick={onFileClick} />
        ))}
      </menu>
    </section>
  )
}

function ChangesTreeView({
  files,
  repositoryPath,
  workspaceId,
  workspacePath,
  onFileClick,
}: {
  files: GitFileStatus[]
  repositoryPath: string
  workspaceId: string | null | undefined
  workspacePath?: string
  onFileClick: (path: string) => void
}) {
  const { t } = useTranslation('workspace')
  const queryClient = useQueryClient()
  const [createDialog, setCreateDialog] = useState<{
    kind: 'file' | 'folder'
    parentPath: string
  } | null>(null)
  const copyPathChordActiveRef = useRef(false)
  const openWorkspaceFileTab = useBrowserPanelStore(state => state.openWorkspaceFileTab)
  const setBrowserPanelOpen = useLayoutStore(state => state.setBrowserPanelOpen)
  const paths = files.map(file => file.path)
  const workspacePathByRepoPath = new Map(files.map(file => [file.path, file.workspacePath]))
  const filePathSet = new Set(paths)
  const preparedInput = prepareFileTreeInput(paths, { flattenEmptyDirectories: true })
  const gitStatus = files.map(file => ({ path: file.path, status: file.status }))
  const resolveWorkspaceRelativePath = (path: string) =>
    workspacePathByRepoPath.get(path) ?? joinRepositoryPath(repositoryPath, path)
  const resolveRepoRelativePath = (path: string) =>
    stripRepositoryPath(repositoryPath, path)
  const refreshChangedFiles = async () => {
    if (!workspaceId) {
      return
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getWorkspacesByWorkspaceIdGitRepositoriesQueryKey({ path: { workspaceId } }) }),
      queryClient.invalidateQueries({
        queryKey: getWorkspacesByWorkspaceIdGitStatusQueryKey({
          path: { workspaceId },
          query: { repo: repositoryPath },
        }),
      }),
      queryClient.invalidateQueries({ queryKey: ['workspace-file-search', workspaceId] }),
    ])
  }
  const commitRename = async (sourcePath: string, destinationPath: string) => {
    if (!workspaceId) {
      return
    }

    await renameWorkspaceFilePath({
      workspaceId,
      sourcePath: resolveWorkspaceRelativePath(sourcePath),
      destinationPath: resolveWorkspaceRelativePath(destinationPath),
      operationFailedMessage: t('fileTree.error.operationFailed'),
    })
    await refreshChangedFiles()
  }

  const { model } = useFileTree({
    preparedInput,
    composition: {
      contextMenu: {
        enabled: true,
        triggerMode: 'both',
        buttonVisibility: 'when-needed',
      },
    },
    density: 'compact',
    dragAndDrop: {
      canDrop: () => false,
    },
    fileTreeSearchMode: 'hide-non-matches',
    gitStatus,
    icons: { set: 'complete', colored: true },
    initialExpansion: 'open',
    renaming: {
      onError: (error) => {
        toastManager.add({
          type: 'error',
          title: t('fileTree.toast.renameFailed'),
          description: formatErrorDescription(error),
        })
        void refreshChangedFiles()
      },
      onRename: (event) => {
        void commitRename(event.sourcePath, event.destinationPath).catch((error) => {
          toastManager.add({
            type: 'error',
            title: t('fileTree.toast.renameFailed'),
            description: formatErrorDescription(error),
          })
          void refreshChangedFiles()
        })
      },
    },
  })
  const commitCreate = async (input: { kind: 'file' | 'folder', parentPath: string, name: string }) => {
    if (!workspaceId) {
      return null
    }

    const nextPath = await createWorkspaceFileEntry({
      workspaceId,
      kind: input.kind,
      parentPath: resolveWorkspaceRelativePath(input.parentPath),
      name: input.name,
      operationFailedMessage: t('fileTree.error.operationFailed'),
    })
    if (!nextPath) {
      return null
    }

    await refreshChangedFiles()
    const repoPath = resolveRepoRelativePath(nextPath)
    model.focusPath(input.kind === 'folder' ? `${repoPath}/` : repoPath)
    return nextPath
  }
  const copyRelativePath = async (path: string) => {
    await navigator.clipboard.writeText(resolveWorkspaceRelativePath(path))
  }
  const copyAbsolutePath = async (path: string) => {
    const relativePath = resolveWorkspaceRelativePath(path)
    await navigator.clipboard.writeText(workspacePath ? joinWorkspacePath(workspacePath, relativePath) : relativePath)
  }
  const openWorkspaceFile = (path: string) => {
    if (!workspaceId) {
      return
    }
    const relativePath = resolveWorkspaceRelativePath(path)
    openWorkspaceFileTab({ workspaceId, path: relativePath, view: getWorkspaceFileDefaultView(relativePath) })
    setBrowserPanelOpen(true)
  }
  const openInDefaultApplication = async (path: string) => {
    if (!workspacePath || !isElectron || !nativeIpc) {
      return
    }

    try {
      await nativeIpc.native.openPath(joinWorkspacePath(workspacePath, resolveWorkspaceRelativePath(path)))
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('fileTree.toast.openDefaultFailed'),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const revealWorkspacePath = async (path: string) => {
    if (!workspacePath || !isElectron || !nativeIpc) {
      return
    }

    try {
      await nativeIpc.native.showItemInFolder(joinWorkspacePath(workspacePath, resolveWorkspaceRelativePath(path)))
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t(platform === 'win32' ? 'fileTree.toast.revealFailedExplorer' : 'fileTree.toast.revealFailed'),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  useEffect(() => {
    model.resetPaths(paths, { preparedInput })
    model.setGitStatus(gitStatus)
  }, [model, paths, preparedInput, gitStatus])

  const handleTreeDoubleClick = (event: ReactMouseEvent<HTMLElement>) => {
    const item = resolveTreeItemFromEvent(event.nativeEvent)
    if (!item || item.kind !== 'file' || !filePathSet.has(item.path)) {
      return
    }
    event.preventDefault()
    model.focusPath(item.path)
    model.getItem(item.path)?.select()
    onFileClick(item.path)
  }

  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const selectedPath = model.getFocusedPath() ?? model.getSelectedPaths()[0]
    if (isCopyPathChordStart(event.nativeEvent)) {
      event.preventDefault()
      copyPathChordActiveRef.current = true
      return
    }
    if (copyPathChordActiveRef.current) {
      copyPathChordActiveRef.current = false
      if (isCopyPathShortcut(event.nativeEvent) && selectedPath) {
        event.preventDefault()
        void copyAbsolutePath(selectedPath)
      }
      return
    }
    if (isCopyRelativePathShortcut(event.nativeEvent) && selectedPath) {
      event.preventDefault()
      void copyRelativePath(selectedPath)
    }
  }

  return (
    <div
      className="min-h-0 flex-1"
      data-testid="changes-panel-tree"
      {...{ [WORKSPACE_FILE_SHORTCUT_SCOPE_ATTRIBUTE]: 'true' }}
      onDoubleClick={handleTreeDoubleClick}
      onKeyDown={handleTreeKeyDown}
      aria-label="Changed files"
      role="tree"
      tabIndex={0}
    >
      <PierreFileTree
        model={model}
        className="h-full"
        renderContextMenu={(item, context) => (
          <WorkspaceFileContextMenu
            context={context}
            item={item}
            onCopyAbsolutePath={copyAbsolutePath}
            onCopyRelativePath={copyRelativePath}
            onCreateRequest={(kind, parentPath) => setCreateDialog({ kind, parentPath })}
            onOpen={(path, kind) => {
              if (kind === 'file') {
                openWorkspaceFile(path)
                return
              }
              model.focusPath(path)
            }}
            onOpenDefault={openInDefaultApplication}
            onRename={(path) => {
              model.startRenaming(path)
            }}
            onReveal={revealWorkspacePath}
            t={t}
            workspacePath={workspacePath}
          />
        )}
        style={
          {
            '--trees-theme-list-active-selection-bg':
              'color-mix(in oklab, var(--color-accent) 30%, transparent)',
            '--trees-theme-list-hover-bg':
              'color-mix(in oklab, var(--color-accent) 30%, transparent)',
            '--trees-theme-list-inactive-selection-bg':
              'color-mix(in oklab, var(--color-accent) 18%, transparent)',
            '--trees-theme-focus-ring': 'var(--color-accent)',
            '--trees-theme-foreground': 'var(--color-sidebar-foreground)',
            '--trees-bg': 'transparent',
            '--trees-search-bg': 'transparent',
            '--trees-padding-inline': '0px',
          } as React.CSSProperties
        }
      />
      <CreateWorkspaceFileDialog
        request={createDialog}
        onOpenChange={open => !open && setCreateDialog(null)}
        onCommit={async (name) => {
          if (!createDialog) {
            return
          }
          try {
            await commitCreate({ ...createDialog, name })
            setCreateDialog(null)
          }
          catch (error) {
            toastManager.add({
              type: 'error',
              title: t('fileTree.toast.createFailed'),
              description: error instanceof Error ? error.message : String(error),
            })
            void refreshChangedFiles()
          }
        }}
        t={t}
      />
    </div>
  )
}

function ChangeFileRow({
  file,
  onClick,
}: {
  file: GitFileStatus
  onClick: (path: string) => void
}) {
  const display = getFileDisplay(file.path)

  return (
    <button
      type="button"
      className="flex h-7 min-w-0 w-full items-center gap-2 border-b border-border/25 px-2 text-xs last:border-b-0 hover:bg-accent/35 text-left"
      title={file.workspacePath}
      data-testid="changes-file-row"
      data-path={file.path}
      data-workspace-path={file.workspacePath}
      data-status={file.status}
      onClick={() => onClick(file.path)}
    >
      <WorkspaceFileIcon path={file.path} />
      <span className="shrink-0 truncate text-foreground/85">{display.name}</span>
      <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground/45">
        {display.directory}
      </span>
      <span
        className={cn(
          'flex h-4 min-w-4 shrink-0 items-center justify-center rounded-sm px-1 text-[9px] font-semibold uppercase tabular-nums',
          {
            'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400': file.status === 'added',
            'bg-sky-500/10 text-sky-600 dark:text-sky-400': file.status === 'modified',
            'bg-red-500/10 text-red-600 dark:text-red-400': file.status === 'deleted',
            'bg-violet-500/10 text-violet-600 dark:text-violet-400': file.status === 'renamed',
            'bg-amber-500/10 text-amber-600 dark:text-amber-400': file.status === 'untracked',
          },
        )}
      >
        {getStatusLabel(file.status)}
      </span>
    </button>
  )
}

function getFileDisplay(path: string): { directory: string | null, name: string } {
  const lastSlash = path.lastIndexOf('/')
  if (lastSlash < 0) {
    return { directory: null, name: path }
  }

  return {
    directory: path.slice(0, lastSlash),
    name: path.slice(lastSlash + 1),
  }
}

function joinRepositoryPath(repositoryPath: string, path: string): string {
  if (repositoryPath === '.') {
    return path
  }
  return path ? `${repositoryPath}/${path}` : repositoryPath
}

function stripRepositoryPath(repositoryPath: string, workspaceRelativePath: string): string {
  if (repositoryPath === '.') {
    return workspaceRelativePath
  }
  if (workspaceRelativePath === repositoryPath) {
    return ''
  }
  const prefix = `${repositoryPath}/`
  return workspaceRelativePath.startsWith(prefix)
    ? workspaceRelativePath.slice(prefix.length)
    : workspaceRelativePath
}

function getWorkspaceDiffRepositoryPath(repositoryPath: string, repositoryCount: number): string | undefined {
  return repositoryPath === '.' && repositoryCount === 1 ? undefined : repositoryPath
}

function getStatusLabel(status: GitFileStatus['status']): string {
  switch (status) {
    case 'added':
      return 'A'
    case 'modified':
      return 'M'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    case 'untracked':
      return 'U'
  }
}
