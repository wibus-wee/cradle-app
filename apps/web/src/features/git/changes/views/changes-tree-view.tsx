import { prepareFileTreeInput } from '@pierre/trees'
import { FileTree as PierreFileTree, useFileTree } from '@pierre/trees/react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CreateWorkspaceFileDialogView } from '~/features/workspace/file-context-menu/views/create-workspace-file-dialog-view'
import { WorkspaceFileContextMenuView } from '~/features/workspace/file-context-menu/views/workspace-file-context-menu-view'
import {
  isCopyPathChordStart,
  isCopyPathShortcut,
  isCopyRelativePathShortcut,
  WORKSPACE_FILE_SHORTCUT_SCOPE_ATTRIBUTE,
} from '~/features/workspace/workspace-file-shortcuts'

import { resolveTreeItemFromEvent } from '../../shared/tree-event-target'
import type { GitFileStatus } from '../../shared/types'

export interface ChangesTreeViewProps {
  files: GitFileStatus[]
  workspacePath?: string
  revealInExplorer: boolean
  onFileClick: (path: string) => void
  onRename: (sourcePath: string, destinationPath: string) => Promise<void>
  onRenameError: (error: unknown) => void
  onCreate: (input: {
    kind: 'file' | 'folder'
    parentPath: string
    name: string
  }) => Promise<string | null>
  onCreateError: (error: unknown) => void
  onCopyAbsolutePath: (path: string) => Promise<void>
  onCopyRelativePath: (path: string) => Promise<void>
  onOpen: (path: string) => void
  onOpenDefault: (path: string) => Promise<void>
  onReveal: (path: string) => Promise<void>
}

export function ChangesTreeView({
  files,
  workspacePath,
  revealInExplorer,
  onFileClick,
  onRename,
  onRenameError,
  onCreate,
  onCreateError,
  onCopyAbsolutePath,
  onCopyRelativePath,
  onOpen,
  onOpenDefault,
  onReveal,
}: ChangesTreeViewProps) {
  const { t } = useTranslation('workspace')
  const { t: tGit } = useTranslation('git')
  const [createDialog, setCreateDialog] = useState<{
    kind: 'file' | 'folder'
    parentPath: string
  } | null>(null)
  const copyPathChordActiveRef = useRef(false)
  const paths = useMemo(() => files.map(file => file.path), [files])
  const filePathSet = useMemo(() => new Set(paths), [paths])
  const preparedInput = useMemo(
    () => prepareFileTreeInput(paths, { flattenEmptyDirectories: true }),
    [paths],
  )
  const gitStatus = useMemo(
    () => files.map(file => ({ path: file.path, status: file.status })),
    [files],
  )
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
      onError: onRenameError,
      onRename: (event) => {
        void onRename(event.sourcePath, event.destinationPath).catch(onRenameError)
      },
    },
  })

  useEffect(() => {
    model.resetPaths(paths, { preparedInput })
    model.setGitStatus(gitStatus)
  }, [gitStatus, model, paths, preparedInput])

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
        void onCopyAbsolutePath(selectedPath)
      }
      return
    }
    if (isCopyRelativePathShortcut(event.nativeEvent) && selectedPath) {
      event.preventDefault()
      void onCopyRelativePath(selectedPath)
    }
  }

  return (
    <div
      className="h-full min-h-0 flex-1"
      data-testid="changes-panel-tree"
      {...{ [WORKSPACE_FILE_SHORTCUT_SCOPE_ATTRIBUTE]: 'true' }}
      onDoubleClick={handleTreeDoubleClick}
      onKeyDown={handleTreeKeyDown}
      aria-label={tGit('changes.treeLabel')}
      role="tree"
      tabIndex={0}
    >
      <PierreFileTree
        model={model}
        className="h-full"
        renderContextMenu={(item, context) => (
          <WorkspaceFileContextMenuView
            context={context}
            item={item}
            onCopyAbsolutePath={onCopyAbsolutePath}
            onCopyRelativePath={onCopyRelativePath}
            onCreateRequest={(kind, parentPath) => {
              setCreateDialog({ kind, parentPath })
            }}
            onOpen={(path, kind) => {
              if (kind === 'file') {
                onOpen(path)
                return
              }
              model.focusPath(path)
            }}
            onOpenDefault={onOpenDefault}
            onRename={(path) => {
              model.startRenaming(path)
            }}
            onReveal={onReveal}
            revealInExplorer={revealInExplorer}
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
      <CreateWorkspaceFileDialogView
        request={createDialog}
        onOpenChange={open => !open && setCreateDialog(null)}
        onCommit={async (name) => {
          if (!createDialog) {
            return
          }
          try {
            const path = await onCreate({ ...createDialog, name })
            if (path) {
              model.focusPath(
                createDialog.kind === 'folder'
                  ? `${path}/`
                  : path,
              )
            }
            setCreateDialog(null)
          }
          catch (error) {
            onCreateError(error)
          }
        }}
        t={t}
      />
    </div>
  )
}
