import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getWorkspacesByWorkspaceIdFilesContentOptions,
  getWorkspacesByWorkspaceIdFilesContentQueryKey,
  getWorkspacesByWorkspaceIdFilesInfoOptions,
  getWorkspacesByWorkspaceIdFilesInfoQueryKey,
  getWorkspacesByWorkspaceIdGitRepositoriesQueryKey,
  getWorkspacesByWorkspaceIdGitStatusQueryKey,
  putWorkspacesByWorkspaceIdFilesContentMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import type { Options } from '~/api-gen/sdk.gen'
import type {
  GetWorkspacesByWorkspaceIdFilesInfoResponse,
  PutWorkspacesByWorkspaceIdFilesContentData,
} from '~/api-gen/types.gen'
import { getServerUrl } from '~/lib/electron'

export type WorkspaceFileInfo = GetWorkspacesByWorkspaceIdFilesInfoResponse

export function workspaceFileContentQueryKey(workspaceId: string | null, path: string | null) {
  return workspaceId && path
    ? getWorkspacesByWorkspaceIdFilesContentQueryKey({ path: { workspaceId }, query: { path } })
    : ['getWorkspacesByWorkspaceIdFilesContent', workspaceId, path] as const
}

export function workspaceFileInfoQueryKey(workspaceId: string | null, path: string | null) {
  return workspaceId && path
    ? getWorkspacesByWorkspaceIdFilesInfoQueryKey({ path: { workspaceId }, query: { path } })
    : ['getWorkspacesByWorkspaceIdFilesInfo', workspaceId, path] as const
}

export function buildWorkspaceFileRawUrl(workspaceId: string, path: string): string {
  return buildWorkspaceFileUrl(workspaceId, 'raw', path)
}

export function buildWorkspaceFilePdfUrl(workspaceId: string, path: string): string {
  return buildWorkspaceFileUrl(workspaceId, 'rendition/pdf', path)
}

export function useWorkspaceFileInfo(workspaceId: string | null, path: string | null) {
  return useQuery({
    ...getWorkspacesByWorkspaceIdFilesInfoOptions({ path: { workspaceId: workspaceId! }, query: { path: path! } }),
    enabled: !!workspaceId && !!path,
    staleTime: 5_000,
  })
}

export function useWorkspaceFileContent(workspaceId: string | null, path: string | null) {
  return useQuery({
    ...getWorkspacesByWorkspaceIdFilesContentOptions({ path: { workspaceId: workspaceId! }, query: { path: path! } }),
    enabled: !!workspaceId && !!path,
    staleTime: 5_000,
  })
}

export function useWorkspaceFileContentMutation(workspaceId: string, path: string) {
  const queryClient = useQueryClient()

  return useMutation({
    ...putWorkspacesByWorkspaceIdFilesContentMutation({ path: { workspaceId } }),
    onSuccess: (result, variables) => {
      if (!result.success) {
        throw new Error('The workspace file was not written.')
      }
      queryClient.setQueryData(workspaceFileContentQueryKey(workspaceId, path), { content: variables.body.content })
      void queryClient.invalidateQueries({
        queryKey: getWorkspacesByWorkspaceIdGitRepositoriesQueryKey({ path: { workspaceId } }),
      })
      void queryClient.invalidateQueries({
        queryKey: getWorkspacesByWorkspaceIdGitStatusQueryKey({ path: { workspaceId } }),
      })
    },
  })
}

export function buildWorkspaceFileContentMutationInput(
  workspaceId: string,
  path: string,
  content: string,
): Options<PutWorkspacesByWorkspaceIdFilesContentData> {
  return {
    path: { workspaceId },
    body: {
      path,
      content,
      confirmedNonCradleOwnedWrite: true,
    },
  }
}

function buildWorkspaceFileUrl(workspaceId: string, route: string, path: string): string {
  const url = new URL(`/workspaces/${encodeURIComponent(workspaceId)}/files/${route}`, getServerUrl())
  url.searchParams.set('path', path)
  return url.toString()
}
