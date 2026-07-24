import { keepPreviousData, useQuery } from '@tanstack/react-query'

import {
  getWorkspacesByWorkspaceIdGitBranchesOptions,
  getWorkspacesByWorkspaceIdGitBranchesQueryKey,
  getWorkspacesByWorkspaceIdGitGraphOptions,
  getWorkspacesByWorkspaceIdGitGraphQueryKey,
  getWorkspacesByWorkspaceIdGitRemotesOptions,
  getWorkspacesByWorkspaceIdGitRepositoriesOptions,
  getWorkspacesByWorkspaceIdGitRepositoriesQueryKey,
  getWorkspacesByWorkspaceIdGitStatusOptions,
  getWorkspacesByWorkspaceIdGitStatusQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import { client } from '~/api-gen/client.gen'
import { queryRefreshPolicies } from '~/lib/query-refresh-policy'

// ─── Re-export generated query key builders so callers don't import from api-gen ──

export { getWorkspacesByWorkspaceIdGitStatusQueryKey as gitStatusQueryKey }
export { getWorkspacesByWorkspaceIdGitRepositoriesQueryKey as gitRepositoriesQueryKey }
export { getWorkspacesByWorkspaceIdGitBranchesQueryKey as gitBranchesQueryKey }
export { getWorkspacesByWorkspaceIdGitGraphQueryKey as gitGraphQueryKey }

export function gitDiffQueryKey(
  workspaceId: string,
  repositoryPath?: string | null,
  paths?: string[],
  sessionId?: string | null,
) {
  return ['git-diff', workspaceId, repositoryPath ?? null, paths?.join(',') ?? null, sessionId ?? null] as const
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

function gitRepositoryQuery(
  repositoryPath: string | null | undefined,
  sessionId?: string | null,
) {
  const query: { repo?: string, sessionId?: string } = {}
  if (repositoryPath) {
    query.repo = repositoryPath
  }
  if (sessionId) {
    query.sessionId = sessionId
  }
  return Object.keys(query).length > 0 ? { query } : {}
}

export function useGitRepositories(
  workspaceId: string | null | undefined,
  sessionId?: string | null,
) {
  return useQuery({
    ...getWorkspacesByWorkspaceIdGitRepositoriesOptions({
      path: { workspaceId: workspaceId! },
      ...gitRepositoryQuery(null, sessionId),
    }),
    ...queryRefreshPolicies.active,
    enabled: !!workspaceId,
    retry: false,
  })
}

export function useGitStatus(
  workspaceId: string | null | undefined,
  repositoryPath?: string | null,
  sessionId?: string | null,
) {
  return useQuery({
    ...getWorkspacesByWorkspaceIdGitStatusOptions({
      path: { workspaceId: workspaceId! },
      ...gitRepositoryQuery(repositoryPath, sessionId),
    }),
    ...queryRefreshPolicies.active,
    enabled: !!workspaceId,
    retry: false,
  })
}

export function useGitFileStatuses(
  workspaceId: string | null | undefined,
  repositoryPath?: string | null,
  sessionId?: string | null,
) {
  return useQuery({
    ...getWorkspacesByWorkspaceIdGitStatusOptions({
      path: { workspaceId: workspaceId! },
      ...gitRepositoryQuery(repositoryPath, sessionId),
    }),
    ...queryRefreshPolicies.active,
    enabled: !!workspaceId,
    retry: false,
    select: data => data.files,
  })
}

export function useGitBranches(
  workspaceId: string | null | undefined,
  repositoryPath?: string | null,
) {
  return useQuery({
    ...getWorkspacesByWorkspaceIdGitBranchesOptions({
      path: { workspaceId: workspaceId! },
      ...gitRepositoryQuery(repositoryPath),
    }),
    ...queryRefreshPolicies.background,
    enabled: !!workspaceId,
    retry: false,
  })
}

export function useGitRemotes(
  workspaceId: string | null | undefined,
  repositoryPath?: string | null,
) {
  return useQuery({
    ...getWorkspacesByWorkspaceIdGitRemotesOptions({
      path: { workspaceId: workspaceId! },
      ...gitRepositoryQuery(repositoryPath),
    }),
    enabled: !!workspaceId,
    ...queryRefreshPolicies.background,
    retry: false,
  })
}

export function useGitGraph(
  workspaceId: string | null | undefined,
  limit: number = 100,
  repositoryPath?: string | null,
) {
  return useQuery({
    ...getWorkspacesByWorkspaceIdGitGraphOptions({
      path: { workspaceId: workspaceId! },
      query: {
        limit: String(limit),
        ...(repositoryPath ? { repo: repositoryPath } : {}),
      },
    }),
    ...queryRefreshPolicies.background,
    enabled: !!workspaceId,
    retry: false,
    placeholderData: keepPreviousData,
  })
}

export function useGitDiff(
  workspaceId: string | null | undefined,
  repositoryPath?: string | null,
  paths?: string[],
  sessionId?: string | null,
) {
  const pathsStr = paths?.length ? paths.join(',') : undefined
  return useQuery({
    queryKey: gitDiffQueryKey(workspaceId ?? '', repositoryPath, paths, sessionId),
    queryFn: async () => {
      const { data, error } = await client.get<string>({
        url: `/workspaces/${workspaceId}/git/diff`,
        query: {
          ...(repositoryPath ? { repo: repositoryPath } : {}),
          ...(pathsStr ? { paths: pathsStr } : {}),
          ...(sessionId ? { sessionId } : {}),
        },
      })
      if (error) {
        throw error
      }
      return data ?? ''
    },
    ...queryRefreshPolicies.active,
    enabled: !!workspaceId,
    retry: false,
  })
}
