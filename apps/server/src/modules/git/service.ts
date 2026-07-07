import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, isAbsolute, join, posix as pathPosix, relative, resolve, sep } from 'node:path'

import type { StatusResult } from 'simple-git'
import simpleGit from 'simple-git'

import { AppError } from '../../errors/app-error'
import * as Workspace from '../workspace/service'
import { resolveSessionExecutionRootById } from '../worktree/service'
import { runGitCommand } from './git-command'

export interface GitStatusView {
  repositoryPath: string
  repositoryName: string
  branch: string
  tracking: string | null
  ahead: number
  behind: number
  isDetached: boolean
  files: GitFileStatusView[]
}

export interface GitRepositoryView {
  path: string
  name: string
  absolutePath: string
  branch: string
  tracking: string | null
  ahead: number
  behind: number
  isDetached: boolean
  files: GitFileStatusView[]
}

export type GitFileStatusKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'

export interface GitFileStatusView {
  path: string
  workspacePath: string
  status: GitFileStatusKind
}

export interface GitLocalBranchView {
  name: string
  isCurrent: boolean
  tracking?: string
}

export interface GitRemoteBranchView {
  name: string
}

export interface GitRemoteView {
  name: string
  fetchUrl: string | null
  pushUrl: string | null
}

export interface GitBranchesView {
  local: GitLocalBranchView[]
  remote: GitRemoteBranchView[]
}

export interface GitGraphCommitView {
  sha: string
  shortSha: string
  parents: string[]
  refs: string[]
  subject: string
  authorName: string
  authorEmail: string
  gravatarHash: string
  date: string
  timestamp: number
}

export interface GitBranchCompareView {
  repositoryPath: string
  repositoryName: string
  baseRef: string
  headRef: string
  baseSha: string
  headSha: string
  mergeBaseSha: string | null
  patch: string
}

export interface GitCommitDiffView {
  repositoryPath: string
  repositoryName: string
  commitRef: string
  commitSha: string
  shortSha: string
  parentSha: string | null
  subject: string
  authorName: string
  authorEmail: string
  timestamp: number
  patch: string
}

export interface GitCommitFileGroupInput {
  message: string
  paths: string[]
}

export interface GitCommitFileGroupResult {
  sha: string
  message: string
  paths: string[]
}

export interface GitCommitFileGroupsResult {
  repositoryPath: string
  repositoryName: string
  commits: GitCommitFileGroupResult[]
}

interface GitRepositoryLocator {
  path: string
  name: string
  absolutePath: string
}

interface ResolvedGitRepository {
  repository: GitRepositoryLocator
}

const FIELD_SEP = '\x1F'
const ROOT_REPOSITORY_PATH = '.'
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const RE_REMOTE_PREFIX = /^remotes\//
const RE_REMOTE_BRANCH = /^[^/]+\/(.+)$/
const MAX_REPOSITORY_SCAN_ENTRIES = 20_000
const REPOSITORY_SCAN_IGNORED_NAMES = new Set([
  '.git',
  '.DS_Store',
  '.cache',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'vendor',
])
const STATUS_RANK: Record<GitFileStatusKind, number> = {
  deleted: 5,
  renamed: 4,
  added: 3,
  modified: 2,
  untracked: 1,
}

function getWorkspacePath(workspaceId: string): string {
  const workspace = Workspace.get(workspaceId)
  if (!workspace) {
    throw new AppError({
      code: 'workspace_not_found',
      status: 404,
      message: 'Workspace not found',
      details: { workspaceId },
    })
  }
  if (workspace.locator.hostId !== 'local') {
    throw new AppError({
      code: 'workspace_local_path_required',
      status: 409,
      message: 'Git operations require a local workspace.',
      details: { workspaceId },
    })
  }
  return workspace.locator.path
}

function resolveGitCwd(workspaceId: string, sessionId?: string | null): string {
  if (sessionId) {
    const execution = resolveSessionExecutionRootById(sessionId)
    if (execution?.isIsolated && execution.rootPath) {
      return execution.rootPath
    }
  }
  return getWorkspacePath(workspaceId)
}

function mapGitError(workspaceId: string, error: unknown, repositoryPath?: string): AppError {
  if (error instanceof AppError) {
    return error
  }

  const message = error instanceof Error ? error.message : String(error)
  return new AppError({
    code: 'git_repository_unavailable',
    status: 409,
    message: 'Git repository unavailable',
    details: { workspaceId, repositoryPath, reason: message },
  })
}

export async function getRepositories(workspaceId: string, sessionId?: string): Promise<GitRepositoryView[]> {
  const workspacePath = sessionId ? resolveGitCwd(workspaceId, sessionId) : getWorkspacePath(workspaceId)
  const repositories = await discoverGitRepositories(workspaceId, workspacePath)
  try {
    return await Promise.all(repositories.map(async (repository) => {
      const status = await readStatus(repository)
    return {
        path: repository.path,
        name: repository.name,
        absolutePath: repository.absolutePath,
        branch: status.branch,
        tracking: status.tracking,
        ahead: status.ahead,
        behind: status.behind,
        isDetached: status.isDetached,
        files: status.files,
      }
    }))
  }
  catch (error) {
    throw mapGitError(workspaceId, error)
  }
}

export async function getStatus(
  workspaceId: string,
  repositoryPath?: string,
  sessionId?: string,
): Promise<GitStatusView> {
  const cwdOverride = sessionId ? resolveGitCwd(workspaceId, sessionId) : undefined
  const { repository } = await resolveRepository(workspaceId, repositoryPath, cwdOverride)
  try {
    return await readStatus(repository)
  }
  catch (error) {
    throw mapGitError(workspaceId, error, repository.path)
  }
}

async function readStatus(
  repository: GitRepositoryLocator,
): Promise<GitStatusView> {
  const status = await simpleGit(repository.absolutePath).status()
  return {
    repositoryPath: repository.path,
    repositoryName: repository.name,
    branch: status.current ?? '(detached)',
    tracking: status.tracking ?? null,
    ahead: status.ahead,
    behind: status.behind,
    isDetached: status.detached,
    files: collectFileStatuses(status, repository.path),
  }
}

function collectFileStatuses(
  status: StatusResult,
  repositoryPath: string,
): GitFileStatusView[] {
  const byPath = new Map<string, GitFileStatusKind>()

  function add(path: string, kind: GitFileStatusKind) {
    const existing = byPath.get(path)
    if (!existing || STATUS_RANK[kind] > STATUS_RANK[existing]) {
      byPath.set(path, kind)
    }
  }

  for (const path of status.not_added) {
    add(path, 'untracked')
  }
  for (const path of status.created) {
    add(path, 'added')
  }
  for (const path of status.modified) {
    add(path, 'modified')
  }
  for (const path of status.deleted) {
    add(path, 'deleted')
  }
  for (const file of status.renamed) {
    add(file.to, 'renamed')
  }

  return Array.from(byPath.entries(), ([path, fileStatus]) => ({
    path,
    workspacePath: toWorkspacePath(repositoryPath, path),
    status: fileStatus,
  })).sort(
    (left, right) => left.path.localeCompare(right.path),
  )
}

export async function getBranches(
  workspaceId: string,
  repositoryPath?: string,
): Promise<GitBranchesView> {
  const { repository } = await resolveRepository(workspaceId, repositoryPath)
  const git = simpleGit(repository.absolutePath)
  try {
    const raw = await git.raw([
      'branch',
      '-a',
      `--format=%(refname:short)${FIELD_SEP}%(upstream:short)${FIELD_SEP}%(HEAD)`,
    ])

    const local: GitLocalBranchView[] = []
    const remote: GitRemoteBranchView[] = []

    for (const line of raw.trim().split('\n')) {
      if (!line.trim()) {
        continue
      }
      const [name, upstream, head] = line.split(FIELD_SEP)
      if (!name) {
        continue
      }

      if (RE_REMOTE_PREFIX.test(name)) {
        const remoteName = name.replace(RE_REMOTE_PREFIX, '')
        if (!remoteName.endsWith('/HEAD')) {
          remote.push({ name: remoteName })
        }
      }
 else {
        local.push({
          name,
          isCurrent: head === '*',
          tracking: upstream?.trim() || undefined,
        })
      }
    }

    return { local, remote }
  }
 catch (error) {
    throw mapGitError(workspaceId, error, repository.path)
  }
}

export async function getRemotes(
  workspaceId: string,
  repositoryPath?: string,
): Promise<GitRemoteView[]> {
  const { repository } = await resolveRepository(workspaceId, repositoryPath)
  const git = simpleGit(repository.absolutePath)
  try {
    const remotes = await git.getRemotes(true)
    return remotes.map(remote => ({
      name: remote.name,
      fetchUrl: remote.refs.fetch ?? null,
      pushUrl: remote.refs.push ?? null,
    }))
  }
 catch (error) {
    throw mapGitError(workspaceId, error, repository.path)
  }
}

export async function getGraph(
  workspaceId: string,
  limit: number,
  repositoryPath?: string,
): Promise<GitGraphCommitView[]> {
  const { repository } = await resolveRepository(workspaceId, repositoryPath)
  const git = simpleGit(repository.absolutePath)
  try {
    const format = `%H${FIELD_SEP}%P${FIELD_SEP}%D${FIELD_SEP}%s${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%at`
    const raw = await git.raw(['log', '--all', `--pretty=format:${format}`, '-n', String(limit)])

    return raw
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map((line) => {
        const [sha, parentsRaw, refsRaw, subject, authorName, authorEmail, timestampStr]
          = line.split(FIELD_SEP)
        const parents = parentsRaw?.trim() ? parentsRaw.trim().split(' ') : []
        const refs = refsRaw?.trim()
          ? refsRaw
              .trim()
              .split(',')
              .map(ref => ref.trim())
              .filter(Boolean)
          : []
        const timestamp = timestampStr ? Number.parseInt(timestampStr, 10) * 1000 : 0

        return {
          sha,
          shortSha: sha.slice(0, 7),
          parents,
          refs,
          subject: subject ?? '',
          authorName: authorName ?? '',
          authorEmail: authorEmail ?? '',
          gravatarHash: createHash('md5')
            .update((authorEmail ?? '').toLowerCase().trim())
            .digest('hex'),
          date: new Date(timestamp).toISOString(),
          timestamp,
        }
      })
  }
 catch (error) {
    throw mapGitError(workspaceId, error, repository.path)
  }
}

export async function checkout(
  workspaceId: string,
  branch: string,
  repositoryPath?: string,
): Promise<void> {
  const { repository } = await resolveRepository(workspaceId, repositoryPath)
  const git = simpleGit(repository.absolutePath)
  try {
    const remoteMatch = RE_REMOTE_BRANCH.exec(branch)
    if (remoteMatch) {
      const localName = remoteMatch[1]
      const summary = await git.branchLocal()
      if (summary.all.includes(localName)) {
        await git.checkout(localName)
      }
 else {
        await git.checkoutBranch(localName, branch)
      }
      return
    }

    await git.checkout(branch)
  }
 catch (error) {
    throw mapGitError(workspaceId, error, repository.path)
  }
}

export async function createBranch(
  workspaceId: string,
  name: string,
  from?: string,
  repositoryPath?: string,
): Promise<void> {
  const { repository } = await resolveRepository(workspaceId, repositoryPath)
  const git = simpleGit(repository.absolutePath)
  try {
    await git.checkoutBranch(name, from ?? 'HEAD')
  }
 catch (error) {
    throw mapGitError(workspaceId, error, repository.path)
  }
}

export async function fetch(workspaceId: string, repositoryPath?: string): Promise<void> {
  const { repository } = await resolveRepository(workspaceId, repositoryPath)
  const git = simpleGit(repository.absolutePath)
  try {
    await git.fetch(['--all', '--prune'])
  }
 catch (error) {
    throw mapGitError(workspaceId, error, repository.path)
  }
}

export async function getDiff(
  workspaceId: string,
  paths?: string[],
  repositoryPath?: string,
): Promise<string> {
  const { repository } = await resolveRepository(workspaceId, repositoryPath)
  try {
    const selectedPaths = normalizeDiffPaths(paths)
    const status = await simpleGit(repository.absolutePath).status()
    const untrackedPaths = collectUntrackedDiffPaths(status, selectedPaths)
    const trackedPaths = selectedPaths?.filter(path => !untrackedPaths.has(path))
    const trackedDiff
      = trackedPaths?.length === 0
        ? ''
        : await runGitCommand(repository.absolutePath, [
            'diff',
            'HEAD',
            ...(trackedPaths ? ['--', ...trackedPaths] : []),
          ])
    const untrackedDiffs: string[] = []
    for (const path of untrackedPaths) {
      untrackedDiffs.push(
        await runGitCommand(repository.absolutePath, ['diff', '--no-index', '--', '/dev/null', path], [1]),
      )
    }
    return joinDiffs([trackedDiff, ...untrackedDiffs])
  }
 catch (error) {
    throw mapGitError(workspaceId, error, repository.path)
  }
}

export async function getMergeBase(
  workspaceId: string,
  baseBranch: string,
  repositoryPath?: string,
): Promise<{ mergeBaseSha: string | null }> {
  const { repository } = await resolveRepository(workspaceId, repositoryPath)
  try {
    const mergeBaseSha = await runGitCommand(repository.absolutePath, ['merge-base', 'HEAD', baseBranch])
    return { mergeBaseSha: mergeBaseSha.trim() || null }
  }
 catch (error) {
    throw mapGitError(workspaceId, error, repository.path)
  }
}

export async function getBranchCompare(
  workspaceId: string,
  baseRef: string,
  headRef: string,
  repositoryPath?: string,
): Promise<GitBranchCompareView> {
  const { repository } = await resolveRepository(workspaceId, repositoryPath)
  try {
    const baseSha = (await runGitCommand(repository.absolutePath, ['rev-parse', '--verify', `${baseRef}^{commit}`])).trim()
    const headSha = (await runGitCommand(repository.absolutePath, ['rev-parse', '--verify', `${headRef}^{commit}`])).trim()
    const mergeBaseSha = (await runGitCommand(repository.absolutePath, ['merge-base', baseSha, headSha])).trim() || null
    const leftRef = mergeBaseSha ?? baseSha
    const patch = await runGitCommand(repository.absolutePath, [
      'diff',
      '--find-renames',
      leftRef,
      headSha,
    ])
    return {
      repositoryPath: repository.path,
      repositoryName: repository.name,
      baseRef,
      headRef,
      baseSha,
      headSha,
      mergeBaseSha,
      patch,
    }
  }
 catch (error) {
    throw mapGitError(workspaceId, error, repository.path)
  }
}

export async function getCommitDiff(
  workspaceId: string,
  commitRef: string,
  repositoryPath?: string,
): Promise<GitCommitDiffView> {
  const { repository } = await resolveRepository(workspaceId, repositoryPath)
  try {
    const commitSha = (await runGitCommand(repository.absolutePath, ['rev-parse', '--verify', `${commitRef}^{commit}`])).trim()
    const raw = await runGitCommand(repository.absolutePath, [
      'show',
      '-s',
      `--format=%H${FIELD_SEP}%h${FIELD_SEP}%P${FIELD_SEP}%s${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%at`,
      commitSha,
    ])
    const [sha, shortSha, parentsRaw, subject, authorName, authorEmail, timestampStr] = raw.trim().split(FIELD_SEP)
    const parentSha = parentsRaw?.trim().split(' ').filter(Boolean)[0] ?? null
    const patch = await runGitCommand(repository.absolutePath, [
      'diff',
      '--find-renames',
      parentSha ?? EMPTY_TREE_SHA,
      commitSha,
    ])
    return {
      repositoryPath: repository.path,
      repositoryName: repository.name,
      commitRef,
      commitSha: sha,
      shortSha,
      parentSha,
      subject: subject ?? '',
      authorName: authorName ?? '',
      authorEmail: authorEmail ?? '',
      timestamp: timestampStr ? Number.parseInt(timestampStr, 10) * 1000 : 0,
      patch,
    }
  }
  catch (error) {
    throw mapGitError(workspaceId, error, repository.path)
  }
}

export async function commitFileGroups(
  workspaceId: string,
  groups: GitCommitFileGroupInput[],
  repositoryPath?: string,
): Promise<GitCommitFileGroupsResult> {
  const { repository } = await resolveRepository(workspaceId, repositoryPath)
  if (groups.length === 0) {
    throw new AppError({
      code: 'git_commit_groups_empty',
      status: 400,
      message: 'Git commit groups must include at least one group',
      details: { workspaceId, repositoryPath: repository.path },
    })
  }

  const commits: GitCommitFileGroupResult[] = []
  let stagedPathsForCurrentGroup: string[] = []
  try {
    const preexistingStagedPaths = parseGitPathList(
      await runGitCommand(repository.absolutePath, ['diff', '--cached', '--name-only', '--']),
    )
    if (preexistingStagedPaths.length > 0) {
      throw new AppError({
        code: 'git_index_not_clean',
        status: 409,
        message: 'Git index must be clean before applying commit groups',
        details: { workspaceId, repositoryPath: repository.path, stagedPaths: preexistingStagedPaths },
      })
    }

    for (const group of groups) {
      if (!group.message.trim()) {
        throw new AppError({
          code: 'git_commit_message_required',
          status: 400,
          message: 'Git commit message is required',
          details: { workspaceId, repositoryPath: repository.path },
        })
      }

      const paths = normalizeRepositoryFilePaths(group.paths)
      if (paths.length === 0) {
        throw new AppError({
          code: 'git_commit_group_paths_empty',
          status: 400,
          message: 'Git commit group must include at least one path',
          details: { workspaceId, repositoryPath: repository.path, message: group.message },
        })
      }

      stagedPathsForCurrentGroup = paths
      await runGitCommand(repository.absolutePath, ['add', '--', ...paths])
      const stagedPaths = parseGitPathList(
        await runGitCommand(repository.absolutePath, ['diff', '--cached', '--name-only', '--', ...paths]),
      )
      if (stagedPaths.length === 0) {
        throw new AppError({
          code: 'git_commit_group_empty',
          status: 409,
          message: 'Git commit group has no staged changes',
          details: { workspaceId, repositoryPath: repository.path, paths },
        })
      }

      await runGitCommand(repository.absolutePath, ['commit', '-m', group.message])
      const sha = (await runGitCommand(repository.absolutePath, ['rev-parse', 'HEAD'])).trim()
      commits.push({
        sha,
        message: group.message,
        paths: stagedPaths,
      })
      stagedPathsForCurrentGroup = []
    }

    return {
      repositoryPath: repository.path,
      repositoryName: repository.name,
      commits,
    }
  }
  catch (error) {
    if (stagedPathsForCurrentGroup.length > 0) {
      await runGitCommand(repository.absolutePath, ['reset', '--', ...stagedPathsForCurrentGroup]).catch(() => '')
    }
    throw mapGitError(workspaceId, error, repository.path)
  }
}

async function resolveRepository(
  workspaceId: string,
  repositoryPath?: string | null,
  cwdOverride?: string,
): Promise<ResolvedGitRepository> {
  const workspacePath = cwdOverride ?? getWorkspacePath(workspaceId)
  const repositories = await discoverGitRepositories(workspaceId, workspacePath)
  const requestedPath = normalizeRepositoryPath(workspaceId, repositoryPath)

  if (requestedPath) {
    const repository = repositories.find(candidate => candidate.path === requestedPath)
    if (!repository) {
      throw new AppError({
        code: 'git_repository_not_found',
        status: 404,
        message: 'Git repository not found',
        details: {
          workspaceId,
          repositoryPath: requestedPath,
          availableRepositories: repositories.map(repository => repository.path),
        },
      })
    }

    return { repository }
  }

  if (repositories.length === 1) {
    return { repository: repositories[0]! }
  }

  if (repositories.length === 0) {
    throw new AppError({
      code: 'git_repository_unavailable',
      status: 409,
      message: 'Git repository unavailable',
      details: { workspaceId, reason: 'No Git repository found in workspace' },
    })
  }

  throw new AppError({
    code: 'git_repository_required',
    status: 409,
    message: 'Git repository is required for workspaces with multiple repositories',
    details: {
      workspaceId,
      repositories: repositories.map(repository => ({
        path: repository.path,
        name: repository.name,
      })),
    },
  })
}

async function discoverGitRepositories(
  workspaceId: string,
  workspacePath: string,
): Promise<GitRepositoryLocator[]> {
  const rootPath = resolve(workspacePath)
  const repositories: GitRepositoryLocator[] = []
  let scannedEntries = 0

  async function visit(directoryPath: string): Promise<void> {
    scannedEntries += 1
    if (scannedEntries > MAX_REPOSITORY_SCAN_ENTRIES) {
      throw new AppError({
        code: 'git_repository_scan_limit_exceeded',
        status: 409,
        message: 'Git repository scan limit exceeded',
        details: { workspaceId, limit: MAX_REPOSITORY_SCAN_ENTRIES },
      })
    }

    if (hasGitMarker(directoryPath)) {
      repositories.push(createRepositoryLocator(rootPath, directoryPath))
      return
    }

    let entries
    try {
      entries = await readdir(directoryPath, { withFileTypes: true })
    }
    catch {
      return
    }

    const directories = entries
      .filter(entry => entry.isDirectory() && !REPOSITORY_SCAN_IGNORED_NAMES.has(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of directories) {
      await visit(join(directoryPath, entry.name))
    }
  }

  await visit(rootPath)
  return repositories.sort(compareRepositories)
}

function hasGitMarker(directoryPath: string): boolean {
  return existsSync(join(directoryPath, '.git'))
}

function createRepositoryLocator(
  workspacePath: string,
  absolutePath: string,
): GitRepositoryLocator {
  const relativePath = relative(workspacePath, absolutePath)
  const repositoryPath = relativePath ? toPosixPath(relativePath) : ROOT_REPOSITORY_PATH
  return {
    path: repositoryPath,
    name: repositoryPath === ROOT_REPOSITORY_PATH ? basename(workspacePath) : pathPosix.basename(repositoryPath),
    absolutePath,
  }
}

function compareRepositories(left: GitRepositoryLocator, right: GitRepositoryLocator): number {
  if (left.path === ROOT_REPOSITORY_PATH) {
    return right.path === ROOT_REPOSITORY_PATH ? 0 : -1
  }
  if (right.path === ROOT_REPOSITORY_PATH) {
    return 1
  }
  return left.path.localeCompare(right.path)
}

function normalizeRepositoryPath(workspaceId: string, repositoryPath?: string | null): string | null {
  if (!repositoryPath) {
    return null
  }

  const trimmedPath = repositoryPath.trim()
  if (!trimmedPath) {
    return null
  }

  const slashPath = trimmedPath.replaceAll('\\', '/')
  if (slashPath === ROOT_REPOSITORY_PATH) {
    return ROOT_REPOSITORY_PATH
  }

  const normalizedPath = pathPosix.normalize(slashPath)
  if (
    isAbsolute(trimmedPath)
    || pathPosix.isAbsolute(normalizedPath)
    || normalizedPath === '..'
    || normalizedPath.startsWith('../')
  ) {
    throw new AppError({
      code: 'git_repository_invalid',
      status: 400,
      message: 'Git repository path must be relative to the workspace',
      details: { workspaceId, repositoryPath },
    })
  }

  return normalizedPath === ROOT_REPOSITORY_PATH ? ROOT_REPOSITORY_PATH : normalizedPath
}

function toWorkspacePath(repositoryPath: string, path: string): string {
  if (repositoryPath === ROOT_REPOSITORY_PATH) {
    return path
  }
  return `${repositoryPath}/${path}`
}

function toPosixPath(path: string): string {
  return path.split(sep).join('/')
}

function normalizeDiffPaths(paths?: string[]): string[] | undefined {
  if (!paths || paths.length === 0) {
    return undefined
  }

  const normalizedPaths = paths.map(path => path.trim()).filter(Boolean)
  return normalizedPaths.length > 0 ? Array.from(new Set(normalizedPaths)) : undefined
}

function normalizeRepositoryFilePaths(paths: string[]): string[] {
  const normalizedPaths: string[] = []
  for (const path of paths) {
    const trimmedPath = path.trim()
    if (!trimmedPath) {
      continue
    }
    const normalizedPath = pathPosix.normalize(trimmedPath.replaceAll('\\', '/'))
    if (
      isAbsolute(trimmedPath)
      || pathPosix.isAbsolute(normalizedPath)
      || normalizedPath === ROOT_REPOSITORY_PATH
      || normalizedPath === '..'
      || normalizedPath.startsWith('../')
    ) {
      throw new AppError({
        code: 'git_path_invalid',
        status: 400,
        message: 'Git file path must be relative to the repository',
        details: { path },
      })
    }
    normalizedPaths.push(normalizedPath)
  }
  return Array.from(new Set(normalizedPaths))
}

function collectUntrackedDiffPaths(status: StatusResult, selectedPaths?: string[]): Set<string> {
  const untrackedPaths = new Set(status.not_added)
  if (!selectedPaths) {
    return untrackedPaths
  }

  return new Set(selectedPaths.filter(path => untrackedPaths.has(path)))
}

function parseGitPathList(output: string): string[] {
  return output.split('\n').map(path => path.trim()).filter(Boolean)
}

function joinDiffs(diffs: string[]): string {
  return diffs
    .map(diff => diff.trimEnd())
    .filter(Boolean)
    .join('\n')
}

export { runGitCommand } from './git-command'
export type { GitWorktreeEntryView } from './worktree-ops'
export {
  addGitWorktree,
  deleteLocalBranch,
  getHeadSha,
  isWorkingTreeDirty,
  listGitWorktrees,
  mergeBranch,
  pruneGitWorktrees,
  removeGitWorktree,
  resolveGitRepoRoot,
  resolveWorktreeAbsolutePath,
  stashAndPopAcrossCheckouts,
} from './worktree-ops'
