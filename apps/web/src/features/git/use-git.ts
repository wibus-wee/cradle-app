import { keepPreviousData, useQuery } from '@tanstack/react-query'

import {
  getWorkspacesByWorkspaceIdGitBranchesOptions,
  getWorkspacesByWorkspaceIdGitBranchesQueryKey,
  getWorkspacesByWorkspaceIdGitDiffOptions,
  getWorkspacesByWorkspaceIdGitDiffQueryKey,
  getWorkspacesByWorkspaceIdGitGraphOptions,
  getWorkspacesByWorkspaceIdGitGraphQueryKey,
  getWorkspacesByWorkspaceIdGitRemotesOptions,
  getWorkspacesByWorkspaceIdGitRepositoriesOptions,
  getWorkspacesByWorkspaceIdGitRepositoriesQueryKey,
  getWorkspacesByWorkspaceIdGitStatusOptions,
  getWorkspacesByWorkspaceIdGitStatusQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import { queryRefreshPolicies } from '~/lib/query-refresh-policy'

// ─── Re-export generated query key builders so callers don't import from api-gen ──

export { getWorkspacesByWorkspaceIdGitStatusQueryKey as gitStatusQueryKey }
export { getWorkspacesByWorkspaceIdGitRepositoriesQueryKey as gitRepositoriesQueryKey }
export { getWorkspacesByWorkspaceIdGitBranchesQueryKey as gitBranchesQueryKey }
export { getWorkspacesByWorkspaceIdGitGraphQueryKey as gitGraphQueryKey }
export { getWorkspacesByWorkspaceIdGitDiffQueryKey as gitDiffQueryKey }

// ─── Hooks ───────────────────────────────────────────────────────────────────

function gitRepositoryQuery(repositoryPath: string | null | undefined) {
  return repositoryPath ? { query: { repo: repositoryPath } } : {}
}

export function useGitRepositories(workspaceId: string | null | undefined) {
  return useQuery({
    ...getWorkspacesByWorkspaceIdGitRepositoriesOptions({ path: { workspaceId: workspaceId! } }),
    ...queryRefreshPolicies.active,
    enabled: !!workspaceId,
    retry: false,
  })
}

export function useGitStatus(
  workspaceId: string | null | undefined,
  repositoryPath?: string | null,
) {
  return useQuery({
    ...getWorkspacesByWorkspaceIdGitStatusOptions({
      path: { workspaceId: workspaceId! },
      ...gitRepositoryQuery(repositoryPath),
    }),
    ...queryRefreshPolicies.active,
    enabled: !!workspaceId,
    retry: false,
  })
}

export function useGitFileStatuses(
  workspaceId: string | null | undefined,
  repositoryPath?: string | null,
) {
  return useQuery({
    ...getWorkspacesByWorkspaceIdGitStatusOptions({
      path: { workspaceId: workspaceId! },
      ...gitRepositoryQuery(repositoryPath),
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
) {
  const pathsStr = paths?.length ? paths.join(',') : undefined
  return useQuery({
    ...getWorkspacesByWorkspaceIdGitDiffOptions({
      path: { workspaceId: workspaceId! },
      ...(repositoryPath || pathsStr
        ? {
            query: {
              ...(repositoryPath ? { repo: repositoryPath } : {}),
              ...(pathsStr ? { paths: pathsStr } : {}),
            },
          }
        : {}),
    }),
    ...queryRefreshPolicies.active,
    enabled: !!workspaceId,
    retry: false,
    select: data => (typeof data === 'string' ? data : ''),
  })
}
