import { z } from 'zod'

import {
  patchWorkspacesByWorkspaceIdFilesPath,
  postWorkspacesByWorkspaceIdFilesFile,
  postWorkspacesByWorkspaceIdFilesFolder,
} from '~/api-gen/sdk.gen'

import { getWorkspaceFileExtension } from '../../workspace-file-language'

export const DEFAULT_NEW_FILE_NAME = 'untitled'
export const DEFAULT_NEW_FOLDER_NAME = 'untitled-folder'

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
