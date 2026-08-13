import type { Command } from 'commander'

import { register as registerWorkspaceCreate } from '../workspace/create'
import { register as registerWorkspaceDelete } from '../workspace/delete'
import { register as registerWorkspaceDiffsAgentFixArtifact } from '../workspace/diffs/agent-fix/artifact'
import { register as registerWorkspaceDiffsAgentFixCancel } from '../workspace/diffs/agent-fix/cancel'
import { register as registerWorkspaceDiffsAgentFixCreate } from '../workspace/diffs/agent-fix/create'
import { register as registerWorkspaceDiffsAgentFixDelete } from '../workspace/diffs/agent-fix/delete'
import { register as registerWorkspaceDiffsAgentFixRerun } from '../workspace/diffs/agent-fix/rerun'
import { register as registerWorkspaceDiffsAgentFixStart } from '../workspace/diffs/agent-fix/start'
import { register as registerWorkspaceDiffsBranchCompare } from '../workspace/diffs/branch-compare'
import { register as registerWorkspaceDiffsClose } from '../workspace/diffs/close'
import { register as registerWorkspaceDiffsCommit } from '../workspace/diffs/commit'
import { register as registerWorkspaceDiffsFileViewed } from '../workspace/diffs/file/viewed'
import { register as registerWorkspaceDiffsGet } from '../workspace/diffs/get'
import { register as registerWorkspaceDiffsGithubPullRequest } from '../workspace/diffs/github-pull-request'
import { register as registerWorkspaceDiffsList } from '../workspace/diffs/list'
import { register as registerWorkspaceDiffsLocalWorkingTree } from '../workspace/diffs/local-working-tree'
import { register as registerWorkspaceDiffsMerge } from '../workspace/diffs/merge'
import { register as registerWorkspaceDiffsPreferencesSet } from '../workspace/diffs/preferences/set'
import { register as registerWorkspaceDiffsReadiness } from '../workspace/diffs/readiness'
import { register as registerWorkspaceDiffsRefresh } from '../workspace/diffs/refresh'
import { register as registerWorkspaceDiffsSubmit } from '../workspace/diffs/submit'
import { register as registerWorkspaceDiffsThreadComment } from '../workspace/diffs/thread/comment'
import { register as registerWorkspaceDiffsThreadCreate } from '../workspace/diffs/thread/create'
import { register as registerWorkspaceDiffsThreadResolve } from '../workspace/diffs/thread/resolve'
import { register as registerWorkspaceFileCreate } from '../workspace/file/create'
import { register as registerWorkspaceFileRead } from '../workspace/file/read'
import { register as registerWorkspaceFileRename } from '../workspace/file/rename'
import { register as registerWorkspaceFileWrite } from '../workspace/file/write'
import { register as registerWorkspaceFiles } from '../workspace/files'
import { register as registerWorkspaceFolderCreate } from '../workspace/folder/create'
import { register as registerWorkspaceGet } from '../workspace/get'
import { register as registerWorkspaceGitBranchCreate } from '../workspace/git/branch/create'
import { register as registerWorkspaceGitBranches } from '../workspace/git/branches'
import { register as registerWorkspaceGitCheckout } from '../workspace/git/checkout'
import { register as registerWorkspaceGitDiff } from '../workspace/git/diff'
import { register as registerWorkspaceGitFetch } from '../workspace/git/fetch'
import { register as registerWorkspaceGitGraph } from '../workspace/git/graph'
import { register as registerWorkspaceGitRepositories } from '../workspace/git/repositories'
import { register as registerWorkspaceGitStatus } from '../workspace/git/status'
import { register as registerWorkspaceImport } from '../workspace/import'
import { register as registerWorkspaceInspect } from '../workspace/inspect'
import { register as registerWorkspaceList } from '../workspace/list'
import { register as registerWorkspaceMigrate } from '../workspace/migrate'
import { register as registerWorkspaceMultiFolderCreate } from '../workspace/multi-folder/create'
import { register as registerWorkspaceMultiFolderImport } from '../workspace/multi-folder/import'
import { register as registerWorkspaceRelink } from '../workspace/relink'
import { register as registerWorkspaceResolve } from '../workspace/resolve'
import { register as registerWorkspaceUpdate } from '../workspace/update'
import { register as registerWorkspaceWorktreeCleanup } from '../workspace/worktree/cleanup'
import { register as registerWorkspaceWorktreeCreate } from '../workspace/worktree/create'
import { register as registerWorkspaceWorktreeList } from '../workspace/worktree/list'

export function registerGeneratedCommands(program: Command): void {
  registerWorkspaceCreate(program)
  registerWorkspaceDelete(program)
  registerWorkspaceDiffsAgentFixArtifact(program)
  registerWorkspaceDiffsAgentFixCancel(program)
  registerWorkspaceDiffsAgentFixCreate(program)
  registerWorkspaceDiffsAgentFixDelete(program)
  registerWorkspaceDiffsAgentFixRerun(program)
  registerWorkspaceDiffsAgentFixStart(program)
  registerWorkspaceDiffsBranchCompare(program)
  registerWorkspaceDiffsClose(program)
  registerWorkspaceDiffsCommit(program)
  registerWorkspaceDiffsFileViewed(program)
  registerWorkspaceDiffsGet(program)
  registerWorkspaceDiffsGithubPullRequest(program)
  registerWorkspaceDiffsList(program)
  registerWorkspaceDiffsLocalWorkingTree(program)
  registerWorkspaceDiffsMerge(program)
  registerWorkspaceDiffsPreferencesSet(program)
  registerWorkspaceDiffsReadiness(program)
  registerWorkspaceDiffsRefresh(program)
  registerWorkspaceDiffsSubmit(program)
  registerWorkspaceDiffsThreadComment(program)
  registerWorkspaceDiffsThreadCreate(program)
  registerWorkspaceDiffsThreadResolve(program)
  registerWorkspaceFileCreate(program)
  registerWorkspaceFileRead(program)
  registerWorkspaceFileRename(program)
  registerWorkspaceFileWrite(program)
  registerWorkspaceFiles(program)
  registerWorkspaceFolderCreate(program)
  registerWorkspaceGet(program)
  registerWorkspaceGitBranchCreate(program)
  registerWorkspaceGitBranches(program)
  registerWorkspaceGitCheckout(program)
  registerWorkspaceGitDiff(program)
  registerWorkspaceGitFetch(program)
  registerWorkspaceGitGraph(program)
  registerWorkspaceGitRepositories(program)
  registerWorkspaceGitStatus(program)
  registerWorkspaceImport(program)
  registerWorkspaceInspect(program)
  registerWorkspaceList(program)
  registerWorkspaceMigrate(program)
  registerWorkspaceMultiFolderCreate(program)
  registerWorkspaceMultiFolderImport(program)
  registerWorkspaceRelink(program)
  registerWorkspaceResolve(program)
  registerWorkspaceUpdate(program)
  registerWorkspaceWorktreeCleanup(program)
  registerWorkspaceWorktreeCreate(program)
  registerWorkspaceWorktreeList(program)
}
