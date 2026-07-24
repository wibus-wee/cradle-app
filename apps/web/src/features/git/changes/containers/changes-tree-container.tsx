import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import {
  getWorkspacesByWorkspaceIdGitRepositoriesQueryKey,
  getWorkspacesByWorkspaceIdGitStatusQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import { toastManager } from '~/components/ui/toast'
import {
  createWorkspaceFileEntry,
  getWorkspaceFileDefaultView,
  joinWorkspacePath,
  renameWorkspaceFilePath,
} from '~/features/workspace/file-context-menu/lib/workspace-file-menu'
import { isElectron, nativeIpc, platform } from '~/lib/electron'
import { useBrowserPanelStore } from '~/store/browser-panel'

import type { GitFileStatus } from '../../shared/types'
import { joinRepositoryPath, stripRepositoryPath } from '../lib/changes-paths'
import { ChangesTreeView } from '../views/changes-tree-view'

function formatErrorDescription(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface ChangesTreeContainerProps {
  files: GitFileStatus[]
  repositoryPath: string
  workspaceId: string
  workspacePath?: string
  onFileClick: (path: string) => void
}

export function ChangesTreeContainer({
  files,
  repositoryPath,
  workspaceId,
  workspacePath,
  onFileClick,
}: ChangesTreeContainerProps) {
  const { t } = useTranslation('workspace')
  const queryClient = useQueryClient()
  const openWorkspaceFileTab = useBrowserPanelStore(state => state.openWorkspaceFileTab)
  const workspacePathByRepoPath = new Map(
    files.map(file => [file.path, file.workspacePath]),
  )
  const resolveWorkspaceRelativePath = (path: string) =>
    workspacePathByRepoPath.get(path) ?? joinRepositoryPath(repositoryPath, path)

  const refreshChangedFiles = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: getWorkspacesByWorkspaceIdGitRepositoriesQueryKey({
          path: { workspaceId },
        }),
      }),
      queryClient.invalidateQueries({
        queryKey: getWorkspacesByWorkspaceIdGitStatusQueryKey({
          path: { workspaceId },
          query: { repo: repositoryPath },
        }),
      }),
      queryClient.invalidateQueries({
        queryKey: ['workspace-file-search', workspaceId],
      }),
    ])
  }

  const handleRename = async (
    sourcePath: string,
    destinationPath: string,
  ) => {
    await renameWorkspaceFilePath({
      workspaceId,
      sourcePath: resolveWorkspaceRelativePath(sourcePath),
      destinationPath: resolveWorkspaceRelativePath(destinationPath),
      operationFailedMessage: t('fileTree.error.operationFailed'),
    })
    await refreshChangedFiles()
  }

  const handleCreate = async (input: {
    kind: 'file' | 'folder'
    parentPath: string
    name: string
  }): Promise<string | null> => {
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
    return stripRepositoryPath(repositoryPath, nextPath)
  }

  const handleRenameError = (error: unknown) => {
    toastManager.add({
      type: 'error',
      title: t('fileTree.toast.renameFailed'),
      description: formatErrorDescription(error),
    })
    void refreshChangedFiles()
  }

  const handleCreateError = (error: unknown) => {
    toastManager.add({
      type: 'error',
      title: t('fileTree.toast.createFailed'),
      description: formatErrorDescription(error),
    })
    void refreshChangedFiles()
  }

  const copyRelativePath = async (path: string) => {
    await navigator.clipboard.writeText(resolveWorkspaceRelativePath(path))
  }

  const copyAbsolutePath = async (path: string) => {
    const relativePath = resolveWorkspaceRelativePath(path)
    await navigator.clipboard.writeText(
      workspacePath
        ? joinWorkspacePath(workspacePath, relativePath)
        : relativePath,
    )
  }

  const openWorkspaceFile = (path: string) => {
    const relativePath = resolveWorkspaceRelativePath(path)
    openWorkspaceFileTab({
      workspaceId,
      path: relativePath,
      view: getWorkspaceFileDefaultView(relativePath),
    })
  }

  const openInDefaultApplication = async (path: string) => {
    if (!workspacePath || !isElectron || !nativeIpc) {
      return
    }

    try {
      await nativeIpc.native.openPath(
        joinWorkspacePath(workspacePath, resolveWorkspaceRelativePath(path)),
      )
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('fileTree.toast.openDefaultFailed'),
        description: formatErrorDescription(error),
      })
    }
  }

  const revealWorkspacePath = async (path: string) => {
    if (!workspacePath || !isElectron || !nativeIpc) {
      return
    }

    try {
      await nativeIpc.native.showItemInFolder(
        joinWorkspacePath(workspacePath, resolveWorkspaceRelativePath(path)),
      )
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t(
          platform === 'win32'
            ? 'fileTree.toast.revealFailedExplorer'
            : 'fileTree.toast.revealFailed',
        ),
        description: formatErrorDescription(error),
      })
    }
  }

  return (
    <ChangesTreeView
      files={files}
      workspacePath={workspacePath}
      revealInExplorer={platform === 'win32'}
      onFileClick={onFileClick}
      onRename={handleRename}
      onRenameError={handleRenameError}
      onCreate={handleCreate}
      onCreateError={handleCreateError}
      onCopyAbsolutePath={copyAbsolutePath}
      onCopyRelativePath={copyRelativePath}
      onOpen={openWorkspaceFile}
      onOpenDefault={openInDefaultApplication}
      onReveal={revealWorkspacePath}
    />
  )
}
