import type {
  GetWorkspacesByWorkspaceIdGitBranchesResponse,
  GetWorkspacesByWorkspaceIdGitGraphResponse,
  GetWorkspacesByWorkspaceIdGitRemotesResponse,
  GetWorkspacesByWorkspaceIdGitRepositoriesResponse,
  GetWorkspacesByWorkspaceIdGitStatusResponse,
} from '~/api-gen/types.gen'

export type GitFileStatus = GetWorkspacesByWorkspaceIdGitStatusResponse['files'][number]
export type GitStatus = GetWorkspacesByWorkspaceIdGitStatusResponse
export type GitRepository = GetWorkspacesByWorkspaceIdGitRepositoriesResponse[number]
export type GitBranches = GetWorkspacesByWorkspaceIdGitBranchesResponse
export type GitRemote = GetWorkspacesByWorkspaceIdGitRemotesResponse[number]
export type GitGraphCommit = GetWorkspacesByWorkspaceIdGitGraphResponse[number]
