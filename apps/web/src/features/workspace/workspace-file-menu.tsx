import {
  ClipboardLine as ClipboardIcon,
  CopyLine as CopyIcon,
  Edit3Line as Edit3Icon,
  ExternalLinkLine as ExternalLinkIcon,
  FileNewLine as FilePlusIcon,
  FolderOpenLine as FolderOpenIcon,
  NewFolderLine as FolderPlusIcon,
} from '@mingcute/react'
import type { ContextMenuItem as TreeContextMenuItem, ContextMenuOpenContext as TreeContextMenuOpenContext } from '@pierre/trees'
import type { TFunction } from 'i18next'
import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'

import {
  patchWorkspacesByWorkspaceIdFilesPath,
  postWorkspacesByWorkspaceIdFilesFile,
  postWorkspacesByWorkspaceIdFilesFolder,
} from '~/api-gen/sdk.gen'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuShortcut } from '~/components/ui/menu'
import { platform } from '~/lib/electron'

import { getWorkspaceFileExtension } from './workspace-file-language'
import {
  isCopyPathChordStart,
  isCopyPathShortcut,
  isCopyRelativePathShortcut,
  VSCODE_COPY_PATH_SHORTCUT,
  VSCODE_COPY_RELATIVE_PATH_SHORTCUT,
  WORKSPACE_FILE_SHORTCUT_SCOPE_ATTRIBUTE,
} from './workspace-file-shortcuts'

export const DEFAULT_NEW_FILE_NAME = 'untitled'
export const DEFAULT_NEW_FOLDER_NAME = 'untitled-folder'

type WorkspaceTranslation = TFunction<'workspace'>

const WorkspaceFileOperationResponseSchema = z.object({
  success: z.boolean(),
})

const RICH_PREVIEW_EXTENSIONS = new Set([
  'bmp',
  'doc',
  'docx',
  'gif',
  'jpeg',
  'jpg',
  'odp',
  'ods',
  'odt',
  'pdf',
  'png',
  'ppt',
  'pptx',
  'rtf',
  'svg',
  'webp',
  'xls',
  'xlsx',
])

export function joinWorkspacePath(workspacePath: string, relativePath: string): string {
  return `${workspacePath.replace(/\/+$/, '')}/${relativePath.replace(/^\/+/, '')}`
}

export function getParentPath(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

function getChildPath(parentPath: string, basename: string): string {
  return parentPath ? `${parentPath}/${basename}` : basename
}

export function readWorkspaceFileOperationSuccess(data: unknown): boolean {
  return WorkspaceFileOperationResponseSchema.parse(data).success
}

export function getWorkspaceFileDefaultView(path: string): 'editor' | 'preview' {
  return RICH_PREVIEW_EXTENSIONS.has(getWorkspaceFileExtension(path)) ? 'preview' : 'editor'
}

export async function createWorkspaceFileEntry(input: {
  workspaceId: string
  kind: 'file' | 'folder'
  parentPath: string
  name: string
  operationFailedMessage: string
}): Promise<string | null> {
  const name = input.name.trim()
  if (!name) {
    return null
  }

  const nextPath = getChildPath(input.parentPath, name)
  const request = {
    path: { workspaceId: input.workspaceId },
    body: {
      path: nextPath,
      confirmedNonCradleOwnedWrite: true,
    },
  }
  const { data } = input.kind === 'file'
    ? await postWorkspacesByWorkspaceIdFilesFile(request)
    : await postWorkspacesByWorkspaceIdFilesFolder(request)

  if (!readWorkspaceFileOperationSuccess(data)) {
    throw new Error(input.operationFailedMessage)
  }
  return nextPath
}

export async function renameWorkspaceFilePath(input: {
  workspaceId: string
  sourcePath: string
  destinationPath: string
  operationFailedMessage: string
}): Promise<void> {
  const { data } = await patchWorkspacesByWorkspaceIdFilesPath({
    path: { workspaceId: input.workspaceId },
    body: {
      sourcePath: input.sourcePath,
      destinationPath: input.destinationPath,
      confirmedNonCradleOwnedWrite: true,
    },
  })

  if (!readWorkspaceFileOperationSuccess(data)) {
    throw new Error(input.operationFailedMessage)
  }
}

export interface WorkspaceFileContextMenuProps {
  context: TreeContextMenuOpenContext
  item: TreeContextMenuItem
  onCopyAbsolutePath: (path: string) => Promise<void>
  onCopyRelativePath: (path: string) => Promise<void>
  onCreateRequest: (kind: 'file' | 'folder', parentPath: string) => void
  onOpen: (path: string, kind: 'file' | 'directory') => void
  onOpenDefault: (path: string) => Promise<void>
  onRename: (path: string) => void
  onReveal: (path: string) => Promise<void>
  t: WorkspaceTranslation
  workspacePath?: string
}

export function WorkspaceFileContextMenu({
  context,
  item,
  onCopyAbsolutePath,
  onCopyRelativePath,
  onCreateRequest,
  onOpen,
  onOpenDefault,
  onRename,
  onReveal,
  t,
  workspacePath,
}: WorkspaceFileContextMenuProps) {
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
        <MenuItem onClick={() => {
          onOpen(item.path, item.kind)
          context.close({ restoreFocus: true })
        }}
        >
          <ExternalLinkIcon />
          {t('fileTree.action.open')}
        </MenuItem>
        {workspacePath && (
          <MenuItem onClick={() => {
            void onOpenDefault(item.path)
            context.close({ restoreFocus: true })
          }}
          >
            <ExternalLinkIcon />
            {t('fileTree.action.openDefault')}
          </MenuItem>
        )}
        {workspacePath && (
          <MenuItem onClick={() => {
            void onReveal(item.path)
            context.close({ restoreFocus: true })
          }}
          >
            <FolderOpenIcon />
            {t(platform === 'win32' ? 'fileTree.action.revealInExplorer' : 'fileTree.action.revealInFinder')}
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem onClick={() => {
          onCreateRequest('file', parentPath)
          context.close({ restoreFocus: false })
        }}
        >
          <FilePlusIcon />
          {t('fileTree.action.newFile')}
        </MenuItem>
        <MenuItem onClick={() => {
          onCreateRequest('folder', parentPath)
          context.close({ restoreFocus: false })
        }}
        >
          <FolderPlusIcon />
          {t('fileTree.action.newFolder')}
        </MenuItem>
        <MenuItem onClick={() => {
          onRename(item.path)
          context.close({ restoreFocus: false })
        }}
        >
          <Edit3Icon />
          {t('fileTree.action.rename')}
        </MenuItem>
        <MenuSeparator />
        <MenuItem onClick={() => {
          void onCopyRelativePath(item.path)
          context.close({ restoreFocus: true })
        }}
        >
          <ClipboardIcon />
          {t('fileTree.action.copyRelativePath')}
          <MenuShortcut>{VSCODE_COPY_RELATIVE_PATH_SHORTCUT}</MenuShortcut>
        </MenuItem>
        <MenuItem onClick={() => {
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

export interface CreateWorkspaceFileDialogProps {
  request: { kind: 'file' | 'folder', parentPath: string } | null
  onOpenChange: (open: boolean) => void
  onCommit: (name: string) => Promise<void>
  t: WorkspaceTranslation
}

export function CreateWorkspaceFileDialog({ request, onOpenChange, onCommit, t }: CreateWorkspaceFileDialogProps) {
  const [name, setName] = useState('')

  useEffect(() => {
    setName(request?.kind === 'folder' ? DEFAULT_NEW_FOLDER_NAME : DEFAULT_NEW_FILE_NAME)
  }, [request])

  const title = request?.kind === 'folder'
    ? t('fileTree.dialog.newFolderTitle')
    : t('fileTree.dialog.newFileTitle')

  return (
    <Dialog open={request !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void onCommit(name)
          }}
        >
          <Input
            autoFocus
            value={name}
            onChange={event => setName(event.currentTarget.value)}
            onFocus={event => event.currentTarget.select()}
            aria-label={t('fileTree.dialog.nameLabel')}
          />
          <DialogFooter variant="bare">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('fileTree.dialog.cancel')}
            </Button>
            <Button type="submit">
              {t('fileTree.dialog.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
