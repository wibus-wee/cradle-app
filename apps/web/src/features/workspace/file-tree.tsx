import {
  CloseLine as XIcon,
  FileNewLine as FilePlusIcon,
  NewFolderLine as FolderPlusIcon,
  SearchLine as SearchIcon,
} from '@mingcute/react'
import { prepareFileTreeInput } from '@pierre/trees'
import { FileTree as PierreFileTree, useFileTree, useFileTreeSelection } from '@pierre/trees/react'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Button } from '~/components/ui/button'
import { DelayedSpinner } from '~/components/ui/spinner'
import { toastManager } from '~/components/ui/toast'
import type { GitFileStatus } from '~/features/git/types'
import { useGitRepositories } from '~/features/git/use-git'
import { useWorkspaceFiles } from '~/features/workspace/use-workspace-files'
import { getAuthenticatedEventSourceUrl, getServerUrl, isElectron, nativeIpc, platform } from '~/lib/electron'
import { queryRefreshPolicies } from '~/lib/query-refresh-policy'
import { serializeWorkspaceFileDragPayload, writeWorkspaceFileDragData } from '~/lib/workspace-drag-data'
import { useBrowserPanelStore } from '~/store/browser-panel'

import type { WorkspaceFileEntry } from './api/files'
import { listWorkspaceFileChildren } from './api/files'
import {
  CreateWorkspaceFileDialog,
  createWorkspaceFileEntry,
  getWorkspaceFileDefaultView,
  joinWorkspacePath,
  renameWorkspaceFilePath,
  WorkspaceFileContextMenu,
} from './workspace-file-menu'
import {
  isCopyPathChordStart,
  isCopyPathShortcut,
  isCopyRelativePathShortcut,
  WORKSPACE_FILE_SHORTCUT_SCOPE_ATTRIBUTE,
} from './workspace-file-shortcuts'

// ── Git status mapper ─────────────────────────────────────────────────────────

type TreeGitStatus = { path: string, status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'ignored' }
const WorkspaceFileEventSchema = z.object({
  type: z.enum(['ready', 'directory-changed']),
  workspaceId: z.string(),
  path: z.string().optional(),
  reason: z.enum(['direct', 'ancestor']).optional(),
  timestamp: z.number(),
})

const ROOT_DIRECTORY_KEY = ''

type WorkspaceFileEvent = z.infer<typeof WorkspaceFileEventSchema>
const EMPTY_WORKSPACE_FILE_ENTRIES: WorkspaceFileEntry[] = []

function toTreeGitStatus(statuses: GitFileStatus[]): TreeGitStatus[] {
  return statuses.map(s => ({ path: s.workspacePath, status: s.status }))
}

function getDraggedTreeItemPath(event: DragEvent): string | null {
  const target = event.target instanceof HTMLElement
    ? event.target.closest('[data-item-path]')
    : null
  if (target instanceof HTMLElement && target.dataset.itemPath) {
    return target.dataset.itemPath
  }

  for (const entry of event.composedPath()) {
    if (entry instanceof HTMLElement && entry.dataset.itemPath) {
      return entry.dataset.itemPath
    }
  }

  return null
}

function getTreeItemFromEvent(event: Event): { path: string, kind: 'file' | 'directory' } | null {
  const target = event.target instanceof HTMLElement
    ? event.target.closest('[data-item-path]')
    : null

  if (target instanceof HTMLElement && target.dataset.itemPath) {
    return {
      path: target.dataset.itemPath,
      kind: target.dataset.itemType === 'folder' ? 'directory' : 'file',
    }
  }

  for (const entry of event.composedPath()) {
    if (entry instanceof HTMLElement && entry.dataset.itemPath) {
      return {
        path: entry.dataset.itemPath,
        kind: entry.dataset.itemType === 'folder' ? 'directory' : 'file',
      }
    }
  }

  return null
}

function getFileTreeInputPaths(entries: WorkspaceFileEntry[]): string[] {
  return entries.map(entry => entry.type === 'directory' ? `${entry.path}/` : entry.path)
}

function getParentDirectoryPath(path: string): string {
  const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path
  const index = normalizedPath.lastIndexOf('/')
  return index < 0 ? ROOT_DIRECTORY_KEY : normalizedPath.slice(0, index)
}

function normalizeDirectoryPath(path: string): string {
  return path.replace(/\/+$/g, '')
}

function toTreeDirectoryPath(path: string): string {
  return path.endsWith('/') ? path : `${path}/`
}

function toTreeEntryPath(entry: WorkspaceFileEntry): string {
  return entry.type === 'directory' ? toTreeDirectoryPath(entry.path) : entry.path
}

function addSearchRevealDirectoryPaths(entry: WorkspaceFileEntry, directories: Set<string>): void {
  const normalizedPath = normalizeDirectoryPath(entry.path)
  directories.add(ROOT_DIRECTORY_KEY)
  if (normalizedPath.length === 0) {
    return
  }

  const segments = normalizedPath.split('/')
  const directoryDepth = entry.type === 'directory' ? segments.length : segments.length - 1
  for (let depth = 1; depth <= directoryDepth; depth += 1) {
    directories.add(segments.slice(0, depth).join('/'))
  }
}

function getSearchRevealDirectoryLoadPaths(entries: WorkspaceFileEntry[]): string[] {
  const directories = new Set<string>()
  for (const entry of entries) {
    addSearchRevealDirectoryPaths(entry, directories)
  }
  return [...directories]
}

function getSearchRevealExpandedTreePaths(entries: WorkspaceFileEntry[]): string[] {
  const expandedTreePaths: string[] = []
  for (const path of getSearchRevealDirectoryLoadPaths(entries)) {
    if (path.length > 0) {
      expandedTreePaths.push(toTreeDirectoryPath(path))
    }
  }
  return expandedTreePaths
}

function readExpandedTreePaths(model: ReturnType<typeof useFileTree>['model'], paths: string[]): string[] {
  const expandedPaths: string[] = []
  for (const path of paths) {
    if (!path.endsWith('/')) {
      continue
    }
    const item = model.getItem(path)
    if (item?.isDirectory() && 'isExpanded' in item && item.isExpanded()) {
      expandedPaths.push(path)
    }
  }
  return expandedPaths
}

function resetFileTreePaths(
  model: ReturnType<typeof useFileTree>['model'],
  paths: string[],
  preparedInput: ReturnType<typeof prepareFileTreeInput>,
  expandedTreePaths: readonly string[] = [],
): void {
  const initialExpandedPaths = new Set(readExpandedTreePaths(model, paths))
  for (const path of expandedTreePaths) {
    initialExpandedPaths.add(path)
  }
  model.resetPaths(paths, {
    preparedInput,
    initialExpandedPaths: [...initialExpandedPaths],
  })
}

function expandFileTreeDirectories(model: ReturnType<typeof useFileTree>['model'], treePaths: readonly string[]): void {
  for (const path of treePaths) {
    const item = model.getItem(path)
    if (!item || !item.isDirectory() || !('isExpanded' in item)) {
      continue
    }
    if (!item.isExpanded()) {
      item.expand()
    }
  }
}

function buildWorkspaceFileEventsUrl(workspaceId: string): string {
  return new URL(`/workspaces/${encodeURIComponent(workspaceId)}/files/events`, getServerUrl()).toString()
}

// ── Main component ────────────────────────────────────────────────────────────

interface FileTreeProps {
  workspaceId: string | null
  workspacePath?: string | null
}

export function FileTree({ workspaceId, workspacePath }: FileTreeProps) {
  const { t } = useTranslation('workspace')
  const [searchQuery, setSearchQuery] = useState('')
  const [createDialog, setCreateDialog] = useState<{
    kind: 'file' | 'folder'
    parentPath: string
  } | null>(null)
  const [childrenByDirectory, setChildrenByDirectory] = useState<Map<string, WorkspaceFileEntry[]>>(() => new Map())
  const loadedDirectoriesRef = useRef<Set<string>>(new Set())
  const loadingDirectoriesRef = useRef<Set<string>>(new Set())
  const rootChildrenQuery = useQuery({
    queryKey: ['workspace-file-children', workspaceId, ROOT_DIRECTORY_KEY],
    queryFn: async () => listWorkspaceFileChildren(workspaceId!, ROOT_DIRECTORY_KEY),
    enabled: !!workspaceId,
    ...queryRefreshPolicies.active,
  })

  const gitRepositoriesQuery = useGitRepositories(workspaceId)

  const gitStatuses = gitRepositoriesQuery.data?.flatMap(repository => repository.files)
  const normalizedSearchQuery = searchQuery.trim()
  const searchEnabled = normalizedSearchQuery.length > 0
  const { files: searchFiles, isPending: searchPending } = useWorkspaceFiles(workspaceId, {
    query: searchQuery,
    limit: 100,
    enabled: searchEnabled,
  })
  const searchRevealEntries = searchEnabled && !searchPending ? searchFiles : EMPTY_WORKSPACE_FILE_ENTRIES

  useEffect(() => {
    setChildrenByDirectory(new Map())
    loadedDirectoriesRef.current = new Set()
    loadingDirectoriesRef.current = new Set()
  }, [workspaceId])

  useEffect(() => {
    if (!rootChildrenQuery.data) {
      return
    }
    loadedDirectoriesRef.current.add(ROOT_DIRECTORY_KEY)
    setChildrenByDirectory((current) => {
      const next = new Map(current)
      next.set(ROOT_DIRECTORY_KEY, rootChildrenQuery.data)
      return next
    })
  }, [rootChildrenQuery.data])

  const paths = (() => {
    const seen = new Set<string>()
    const entries = [...childrenByDirectory.values()].flat().filter((entry) => {
      const key = entry.type === 'directory' ? `${entry.path}/` : entry.path
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
    return getFileTreeInputPaths(entries)
  })()

  const preparedInput = paths.length > 0 ? prepareFileTreeInput(paths, { flattenEmptyDirectories: true }) : null

  const treeGitStatus = gitStatuses ? toTreeGitStatus(gitStatuses) : undefined
  const refreshWorkspaceFiles = async () => {
    if (!workspaceId) {
      return
    }
    const directories = [...loadedDirectoriesRef.current]
    const updates = await Promise.all(directories.map(async directoryPath => [
      directoryPath,
      await listWorkspaceFileChildren(workspaceId, directoryPath),
    ] as const))
    setChildrenByDirectory(new Map(updates))
  }
  const loadDirectoryChildren = useCallback(async (directoryPath: string, force = false) => {
    if (!workspaceId) {
      return
    }
    const normalizedPath = normalizeDirectoryPath(directoryPath)
    if (!force && loadedDirectoriesRef.current.has(normalizedPath)) {
      return
    }
    if (loadingDirectoriesRef.current.has(normalizedPath)) {
      return
    }

    loadingDirectoriesRef.current.add(normalizedPath)
    try {
      const children = await listWorkspaceFileChildren(workspaceId, normalizedPath)
      loadedDirectoriesRef.current.add(normalizedPath)
      setChildrenByDirectory((current) => {
        const next = new Map(current)
        next.set(normalizedPath, children)
        return next
      })
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('fileTree.toast.loadFailed'),
        description: error instanceof Error ? error.message : String(error),
      })
    }
    finally {
      loadingDirectoriesRef.current.delete(normalizedPath)
    }
  }, [t, workspaceId])
  useEffect(() => {
    if (!searchEnabled || searchPending || searchFiles.length === 0) {
      return
    }

    const directoryPaths = getSearchRevealDirectoryLoadPaths(searchFiles)
    void Promise.all(directoryPaths.map(directoryPath => loadDirectoryChildren(directoryPath)))
  }, [loadDirectoryChildren, searchEnabled, searchFiles, searchPending])
  useEffect(() => {
    if (!workspaceId) {
      return
    }

    let eventSource: EventSource | null = null
    let cancelled = false
    let malformedFrameReported = false
    void getAuthenticatedEventSourceUrl(buildWorkspaceFileEventsUrl(workspaceId)).then((url) => {
      if (cancelled) {
        return
      }
      eventSource = new EventSource(url)
      eventSource.onmessage = (event) => {
      let message: WorkspaceFileEvent
      try {
        message = WorkspaceFileEventSchema.parse(JSON.parse(event.data))
      }
 catch (error) {
        if (!malformedFrameReported) {
          malformedFrameReported = true
          console.warn('[file-tree] dropped malformed workspace file event', error)
        }
        return
      }
      if (message.type !== 'directory-changed') {
        return
      }
      const path = normalizeDirectoryPath(message.path ?? ROOT_DIRECTORY_KEY)
      if (!loadedDirectoriesRef.current.has(path)) {
        return
      }
      void loadDirectoryChildren(path, true)
      }
      eventSource.onerror = () => {
        // EventSource reconnects automatically while the short-lived ticket remains attached.
      }
    }).catch(error => console.warn('[file-tree] failed to open workspace file events', error))
    return () => {
      cancelled = true
      eventSource?.close()
    }
  }, [loadDirectoryChildren, workspaceId])
  const commitCreate = async (input: { kind: 'file' | 'folder', parentPath: string, name: string }) => {
    if (!workspaceId) {
      return null
    }

    return createWorkspaceFileEntry({
      workspaceId,
      kind: input.kind,
      parentPath: input.parentPath,
      name: input.name,
      operationFailedMessage: t('fileTree.error.operationFailed'),
    })
  }

  if (!workspaceId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-xs text-muted-foreground">{t('fileTree.status.noWorkspace')}</p>
      </div>
    )
  }

  if (rootChildrenQuery.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <DelayedSpinner active className="size-4 text-muted-foreground/40" />
      </div>
    )
  }

  if (!preparedInput) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-xs text-muted-foreground">{t('fileTree.status.empty')}</p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => setCreateDialog({ kind: 'file', parentPath: '' })}
          >
            <FilePlusIcon />
            {t('fileTree.action.newFile')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => setCreateDialog({ kind: 'folder', parentPath: '' })}
          >
            <FolderPlusIcon />
            {t('fileTree.action.newFolder')}
          </Button>
        </div>
        <CreateWorkspaceFileDialog
          request={createDialog}
          onOpenChange={open => !open && setCreateDialog(null)}
          onCommit={async (name) => {
            if (!createDialog) {
              return
            }
            try {
              await commitCreate({ ...createDialog, name })
              await refreshWorkspaceFiles()
              setCreateDialog(null)
            }
            catch (error) {
              toastManager.add({
                type: 'error',
                title: t('fileTree.toast.createFailed'),
                description: error instanceof Error ? error.message : String(error),
              })
              void refreshWorkspaceFiles()
            }
          }}
          t={t}
        />
      </div>
    )
  }

  return (
    <FileTreeInner
      workspaceId={workspaceId}
      paths={paths}
      preparedInput={preparedInput}
      ready={rootChildrenQuery.isSuccess && gitRepositoriesQuery.isSuccess && !searchPending}
      gitStatus={treeGitStatus}
      onDirectoryExpanded={loadDirectoryChildren}
      onRefreshDirectory={loadDirectoryChildren}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      searchPending={searchPending}
      searchResultCount={searchEnabled && !searchPending ? searchFiles.length : 0}
      searchRevealEntries={searchRevealEntries}
      workspacePath={workspacePath ?? undefined}
    />
  )
}

// ── Inner tree (mounted once model exists) ────────────────────────────────────

interface FileTreeInnerProps {
  workspaceId: string
  paths: string[]
  preparedInput: ReturnType<typeof prepareFileTreeInput>
  ready: boolean
  gitStatus?: TreeGitStatus[]
  onDirectoryExpanded: (path: string) => Promise<void>
  onRefreshDirectory: (path: string, force?: boolean) => Promise<void>
  searchQuery: string
  onSearchQueryChange: (query: string) => void
  searchPending: boolean
  searchResultCount: number
  searchRevealEntries: WorkspaceFileEntry[]
  workspacePath?: string
}

function FileTreeInner({ workspaceId, paths, preparedInput, ready, gitStatus, onDirectoryExpanded, onRefreshDirectory, searchQuery, onSearchQueryChange, searchPending, searchResultCount, searchRevealEntries, workspacePath }: FileTreeInnerProps) {
  const { t } = useTranslation('workspace')
  const [createDialog, setCreateDialog] = useState<{
    kind: 'file' | 'folder'
    parentPath: string
  } | null>(null)
  const activeWorkspaceFilePath = useBrowserPanelStore((state) => {
    const activeTab = state.tabs.find(tab => tab.id === state.activeTabId)
    if (activeTab?.kind !== 'workspace-file' || activeTab.workspaceId !== workspaceId) {
      return null
    }
    return activeTab.path
  })
  const openWorkspaceFileTab = useBrowserPanelStore(state => state.openWorkspaceFileTab)
  const activeWorkspaceFilePathRef = useRef<string | null>(null)
  const copyPathChordActiveRef = useRef(false)
  const refreshWorkspaceFiles = async () => {
    await onRefreshDirectory(ROOT_DIRECTORY_KEY, true)
  }
  const commitRename = async (sourcePath: string, destinationPath: string) => {
    await renameWorkspaceFilePath({
      workspaceId,
      sourcePath,
      destinationPath,
      operationFailedMessage: t('fileTree.error.operationFailed'),
    })
    await onRefreshDirectory(getParentDirectoryPath(destinationPath), true)
  }
  const handleRenameError = (error: unknown) => {
    toastManager.add({
      type: 'error',
      title: t('fileTree.toast.renameFailed'),
      description: error instanceof Error ? error.message : String(error),
    })
    void onRefreshDirectory(ROOT_DIRECTORY_KEY, true)
  }

  const { model } = useFileTree({
    preparedInput,
    dragAndDrop: {
      canDrop: () => false,
    },
    icons: { set: 'complete', colored: true },
    density: 'compact',
    initialExpansion: 'closed',
    initialExpandedPaths: ['src'],
    gitStatus,
    renaming: {
      onError: handleRenameError,
      onRename: (event) => {
        void commitRename(event.sourcePath, event.destinationPath).catch(handleRenameError)
      },
    },
    // renderRowDecoration: ({ item }) => {
    //   if (item.kind !== 'file' || item.path !== activeWorkspaceFilePathRef.current) {
    //     return null
    //   }
    //   return { text: 'OPEN', title: 'Active editor tab' }
    // },
    composition: {
      contextMenu: {
        enabled: true,
        triggerMode: 'both',
        buttonVisibility: 'when-needed',
      },
    },
  })

  const selectedPaths = useFileTreeSelection(model)
  const hasSearchValue = searchQuery.trim().length > 0

  const openWorkspaceFile = (path: string, view: 'editor' | 'preview') => {
    openWorkspaceFileTab({ workspaceId, path, view })
  }
  const copyRelativePath = async (path: string) => {
    await navigator.clipboard.writeText(path)
  }
  const copyAbsolutePath = async (path: string) => {
    await navigator.clipboard.writeText(workspacePath ? joinWorkspacePath(workspacePath, path) : path)
  }
  const openInDefaultApplication = async (path: string) => {
    if (!workspacePath || !isElectron || !nativeIpc) {
      return
    }

    try {
      await nativeIpc.native.openPath(joinWorkspacePath(workspacePath, path))
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('fileTree.toast.openDefaultFailed'),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const commitCreate = async (input: { kind: 'file' | 'folder', parentPath: string, name: string }) => {
    const nextPath = await createWorkspaceFileEntry({
      workspaceId,
      kind: input.kind,
      parentPath: input.parentPath,
      name: input.name,
      operationFailedMessage: t('fileTree.error.operationFailed'),
    })
    if (!nextPath) {
      return
    }

    await onRefreshDirectory(input.parentPath, true)
    model.focusPath(input.kind === 'folder' ? `${nextPath}/` : nextPath)
  }
  const startDragFromTree = useEffectEvent((event: DragEvent) => {
    const itemPath = getDraggedTreeItemPath(event)
    if (!itemPath || !event.dataTransfer) {
      return
    }

    writeWorkspaceFileDragData(
      event.dataTransfer,
      serializeWorkspaceFileDragPayload({ relativePath: itemPath, workspacePath }),
    )
    event.dataTransfer.effectAllowed = 'copy'
  })
  const openWorkspaceFileFromTree = (path: string) => {
    openWorkspaceFile(path, getWorkspaceFileDefaultView(path))
  }
  const openPeekFromTree = (path: string) => {
    openWorkspaceFile(path, 'preview')
  }
  const revealWorkspacePath = async (path: string) => {
    if (!workspacePath || !isElectron || !nativeIpc) {
      return
    }

    try {
      await nativeIpc.native.showItemInFolder(joinWorkspacePath(workspacePath, path))
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
    const searchRevealExpandedTreePaths = hasSearchValue ? getSearchRevealExpandedTreePaths(searchRevealEntries) : []
    resetFileTreePaths(model, paths, preparedInput, searchRevealExpandedTreePaths)
  }, [hasSearchValue, model, paths, preparedInput, searchRevealEntries])

  useEffect(() => {
    const normalizedQuery = searchQuery.trim()
    model.setSearch(null)
    if (normalizedQuery.length === 0) {
      return
    }

    const searchRevealExpandedTreePaths = getSearchRevealExpandedTreePaths(searchRevealEntries)
    expandFileTreeDirectories(model, searchRevealExpandedTreePaths)
    const firstRevealEntry = searchRevealEntries[0]
    if (firstRevealEntry) {
      model.focusPath(toTreeEntryPath(firstRevealEntry))
    }
  }, [model, searchQuery, searchRevealEntries])

  // Update git status when it changes
  useEffect(() => {
    model.setGitStatus(gitStatus)
  }, [model, gitStatus])

  useEffect(() => {
    activeWorkspaceFilePathRef.current = activeWorkspaceFilePath

    if (!activeWorkspaceFilePath) {
      return
    }

    const item = model.getItem(activeWorkspaceFilePath)
    if (!item || item.isDirectory()) {
      return
    }

    for (const selectedPath of model.getSelectedPaths()) {
      if (selectedPath !== activeWorkspaceFilePath) {
        model.getItem(selectedPath)?.deselect()
      }
    }
    if (!item.isSelected()) {
      item.select()
    }
    item.focus()
  }, [activeWorkspaceFilePath, model, paths, preparedInput])

  // Drag handler: expose workspace file paths to chat and TUI drop targets.
  useEffect(() => {
    const container = model.getFileTreeContainer()
    if (!container) {
      return
    }

    function handleDragStart(event: DragEvent) {
      startDragFromTree(event)
    }

    container.addEventListener('dragstart', handleDragStart)
    return () => container.removeEventListener('dragstart', handleDragStart)
  }, [model])

  useEffect(() => {
    const container = model.getFileTreeContainer()
    if (!container) {
      return
    }

    function loadDirectoryIfCollapsed(path: string | null) {
      if (!path) {
        return
      }
      const item = model.getItem(path)
      if (!item || !item.isDirectory() || !('isExpanded' in item)) {
        return
      }
      if (item.isExpanded()) {
        return
      }
      void onDirectoryExpanded(normalizeDirectoryPath(path))
    }

    function handlePointerDown(event: MouseEvent) {
      const item = getTreeItemFromEvent(event)
      if (item?.kind === 'directory') {
        loadDirectoryIfCollapsed(item.path)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'ArrowRight' && event.key !== 'Enter') {
        return
      }
      loadDirectoryIfCollapsed(model.getFocusedPath())
    }

    container.addEventListener('pointerdown', handlePointerDown, { capture: true })
    container.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => {
      container.removeEventListener('pointerdown', handlePointerDown, { capture: true })
      container.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [model, onDirectoryExpanded])

  useEffect(() => {
    const container = model.getFileTreeContainer()
    if (!container) {
      return
    }

    function handleDoubleClick(event: MouseEvent) {
      const item = getTreeItemFromEvent(event)
      if (!item || item.kind !== 'file') {
        return
      }
      event.preventDefault()
      model.focusPath(item.path)
      const handle = model.getItem(item.path)
      handle?.select()
      openWorkspaceFileFromTree(item.path)
    }

    function handleKeyDown(event: KeyboardEvent) {
      const selectedPath = model.getFocusedPath() ?? model.getSelectedPaths()[0]
      if (isCopyPathChordStart(event)) {
        event.preventDefault()
        copyPathChordActiveRef.current = true
        return
      }
      if (copyPathChordActiveRef.current) {
        copyPathChordActiveRef.current = false
        if (isCopyPathShortcut(event) && selectedPath) {
          event.preventDefault()
          void copyAbsolutePath(selectedPath)
        }
        return
      }
      if (isCopyRelativePathShortcut(event) && selectedPath) {
        event.preventDefault()
        void copyRelativePath(selectedPath)
        return
      }
      if (event.key !== ' ' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return
      }
      if (!selectedPath) {
        return
      }
      const selectedItem = model.getItem(selectedPath)
      if (!selectedItem || selectedItem.isDirectory()) {
        return
      }
      event.preventDefault()
      openPeekFromTree(selectedPath)
    }

    container.addEventListener('dblclick', handleDoubleClick)
    container.addEventListener('keydown', handleKeyDown)
    return () => {
      container.removeEventListener('dblclick', handleDoubleClick)
      container.removeEventListener('keydown', handleKeyDown)
    }
  }, [copyAbsolutePath, copyRelativePath, model, openPeekFromTree, openWorkspaceFileFromTree])

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden pt-2"
      data-testid="right-aside-file-tree"
      data-right-aside-files-ready={ready ? 'true' : 'false'}
      {...{ [WORKSPACE_FILE_SHORTCUT_SCOPE_ATTRIBUTE]: 'true' }}
    >
      <div className="shrink-0 px-2 pb-2">
        <div className="flex h-8 items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2 focus-within:border-ring/50 focus-within:ring-2 focus-within:ring-ring/15">
          <SearchIcon className="size-3.5 shrink-0 !text-muted-foreground/60" aria-hidden="true" />
          <input
            value={searchQuery}
            onChange={event => onSearchQueryChange(event.target.value)}
            placeholder={t('fileTree.search.placeholder')}
            aria-label={t('fileTree.search.aria')}
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/45"
          />
          {hasSearchValue && (
            searchPending
              ? <DelayedSpinner active className="size-3 shrink-0 text-muted-foreground/40" />
              : (
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/55" data-testid="right-aside-file-search-count">
                    {searchResultCount}
                  </span>
                )
          )}
          {hasSearchValue && (
            <button
              type="button"
              onClick={() => onSearchQueryChange('')}
              aria-label={t('fileTree.action.clearSearch')}
              className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
            >
              <XIcon className="size-3" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Tree */}
      <PierreFileTree
        model={model}
        className="flex-1"
        style={{
          '--trees-theme-list-active-selection-bg': 'color-mix(in oklab, var(--color-accent) 30%, transparent)',
          '--trees-theme-list-hover-bg': 'color-mix(in oklab, var(--color-accent) 30%, transparent)',
          '--trees-theme-list-inactive-selection-bg': 'color-mix(in oklab, var(--color-accent) 18%, transparent)',
          '--trees-theme-focus-ring': 'var(--color-accent)',
          '--trees-theme-foreground': 'var(--color-sidebar-foreground)',
          '--trees-bg': 'transparent',
          '--trees-search-bg': 'transparent',
        } as React.CSSProperties}
        renderContextMenu={(item, context) => (
          <WorkspaceFileContextMenu
            context={context}
            item={item}
            onCopyAbsolutePath={copyAbsolutePath}
            onCopyRelativePath={copyRelativePath}
            onCreateRequest={(kind, parentPath) => setCreateDialog({ kind, parentPath })}
            onOpen={(path, kind) => {
              if (kind === 'file') {
                openWorkspaceFile(path, getWorkspaceFileDefaultView(path))
                return
              }
              model.focusPath(toTreeDirectoryPath(path))
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
            void refreshWorkspaceFiles()
          }
        }}
        t={t}
      />

      {/* Status bar */}
      {selectedPaths.length > 0 && (
        <div className="shrink-0 border-t border-border px-2.5 py-1">
          <p className="truncate text-[10px] text-muted-foreground/50">
            {selectedPaths.length === 1 ? selectedPaths[0] : t('fileTree.selection.files', { count: selectedPaths.length })}
          </p>
        </div>
      )}
    </div>
  )
}
