import {
  ClipboardLine as ClipboardIcon,
  CopyLine as CopyIcon,
  Edit3Line as Edit3Icon,
  ExternalLinkLine as ExternalLinkIcon,
  FileNewLine as FilePlusIcon,
  FolderOpenLine as FolderOpenIcon,
  NewFolderLine as FolderPlusIcon,
} from '@mingcute/react'
import type {
  ContextMenuItem as TreeContextMenuItem,
  ContextMenuOpenContext as TreeContextMenuOpenContext,
} from '@pierre/trees'
import type { TFunction } from 'i18next'
import { useRef } from 'react'

import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuShortcut } from '~/components/ui/menu'

import {
  isCopyPathChordStart,
  isCopyPathShortcut,
  isCopyRelativePathShortcut,
  VSCODE_COPY_PATH_SHORTCUT,
  VSCODE_COPY_RELATIVE_PATH_SHORTCUT,
  WORKSPACE_FILE_SHORTCUT_SCOPE_ATTRIBUTE,
} from '../../workspace-file-shortcuts'
import { getParentPath } from '../lib/workspace-file-menu'

type WorkspaceTranslation = TFunction<'workspace'>

export interface WorkspaceFileContextMenuViewProps {
  context: TreeContextMenuOpenContext
  item: TreeContextMenuItem
  onCopyAbsolutePath: (path: string) => Promise<void>
  onCopyRelativePath: (path: string) => Promise<void>
  onCreateRequest: (kind: 'file' | 'folder', parentPath: string) => void
  onOpen: (path: string, kind: 'file' | 'directory') => void
  onOpenDefault: (path: string) => Promise<void>
  onRename: (path: string) => void
  onReveal: (path: string) => Promise<void>
  revealInExplorer: boolean
  t: WorkspaceTranslation
  workspacePath?: string
}

export function WorkspaceFileContextMenuView({
  context,
  item,
  onCopyAbsolutePath,
  onCopyRelativePath,
  onCreateRequest,
  onOpen,
  onOpenDefault,
  onRename,
  onReveal,
  revealInExplorer,
  t,
  workspacePath,
}: WorkspaceFileContextMenuViewProps) {
  const copyPathChordActiveRef = useRef(false)
  const parentPath = item.kind === 'directory' ? item.path : getParentPath(item.path)

  return (
    <Menu
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) {
          context.close({ restoreFocus: true })
        }
      }}
    >
      <MenuPopup
        align="start"
        anchor={context.anchorElement}
        className="w-64"
        collisionAvoidance={{ side: 'flip', align: 'shift' }}
        data-file-tree-context-menu-root="true"
        {...{ [WORKSPACE_FILE_SHORTCUT_SCOPE_ATTRIBUTE]: 'true' }}
        onKeyDown={(event) => {
          if (isCopyPathChordStart(event.nativeEvent)) {
            event.preventDefault()
            event.stopPropagation()
            copyPathChordActiveRef.current = true
            return
          }

          if (copyPathChordActiveRef.current) {
            copyPathChordActiveRef.current = false
            if (isCopyPathShortcut(event.nativeEvent)) {
              event.preventDefault()
              event.stopPropagation()
              void onCopyAbsolutePath(item.path)
              context.close({ restoreFocus: true })
            }
            return
          }

          if (isCopyRelativePathShortcut(event.nativeEvent)) {
            event.preventDefault()
            event.stopPropagation()
            void onCopyRelativePath(item.path)
            context.close({ restoreFocus: true })
          }
        }}
        portalProps={{ container: context.anchorElement.ownerDocument.body }}
        side="bottom"
        sideOffset={4}
      >
        <MenuItem
          onClick={() => {
            onOpen(item.path, item.kind)
            context.close({ restoreFocus: true })
          }}
        >
          <ExternalLinkIcon />
          {t('fileTree.action.open')}
        </MenuItem>
        {workspacePath && (
          <MenuItem
            onClick={() => {
              void onOpenDefault(item.path)
              context.close({ restoreFocus: true })
            }}
          >
            <ExternalLinkIcon />
            {t('fileTree.action.openDefault')}
          </MenuItem>
        )}
        {workspacePath && (
          <MenuItem
            onClick={() => {
              void onReveal(item.path)
              context.close({ restoreFocus: true })
            }}
          >
            <FolderOpenIcon />
            {t(revealInExplorer ? 'fileTree.action.revealInExplorer' : 'fileTree.action.revealInFinder')}
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem
          onClick={() => {
            onCreateRequest('file', parentPath)
            context.close({ restoreFocus: false })
          }}
        >
          <FilePlusIcon />
          {t('fileTree.action.newFile')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            onCreateRequest('folder', parentPath)
            context.close({ restoreFocus: false })
          }}
        >
          <FolderPlusIcon />
          {t('fileTree.action.newFolder')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            onRename(item.path)
            context.close({ restoreFocus: false })
          }}
        >
          <Edit3Icon />
          {t('fileTree.action.rename')}
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          onClick={() => {
            void onCopyRelativePath(item.path)
            context.close({ restoreFocus: true })
          }}
        >
          <ClipboardIcon />
          {t('fileTree.action.copyRelativePath')}
          <MenuShortcut>{VSCODE_COPY_RELATIVE_PATH_SHORTCUT}</MenuShortcut>
        </MenuItem>
        <MenuItem
          onClick={() => {
            void onCopyAbsolutePath(item.path)
            context.close({ restoreFocus: true })
          }}
        >
          <CopyIcon />
          {t('fileTree.action.copyPath')}
          <MenuShortcut>{VSCODE_COPY_PATH_SHORTCUT}</MenuShortcut>
        </MenuItem>
      </MenuPopup>
    </Menu>
  )
}
