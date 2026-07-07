import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { workspaces } from '@cradle/db'
import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import {
  addGitWorktree,
  getHeadSha,
  isWorkingTreeDirty,
  listGitWorktrees,
  removeGitWorktree,
  stashAndPopAcrossCheckouts,
} from '../src/modules/git/worktree-ops'
import { workspaceFixture } from './helpers/workspace-fixture'

interface GitStatus {
  repositoryPath: string
  repositoryName: string
  branch: string
  tracking: string | null
  ahead: number
  behind: number
  isDetached: boolean
  files: GitFileStatus[]
}

interface GitFileStatus {
  path: string
  workspacePath: string
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'
}

interface GitRepository {
  path: string
  name: string
  absolutePath: string
  branch: string
  tracking: string | null
  ahead: number
  behind: number
  isDetached: boolean
  files: GitFileStatus[]
}

interface GitBranches {
  local: Array<{ name: string, isCurrent: boolean, tracking?: string }>
  remote: Array<{ name: string }>
}

interface GitGraphCommit {
  subject: string
  shortSha: string
}

interface TestInfraEnv {
  dataDir?: string
  dbPath?: string
}

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function useIsolatedTestInfra(dataDir: string): TestInfraEnv {
  const previous = {
    dataDir: process.env.CRADLE_DATA_DIR,
    dbPath: process.env.CRADLE_DB_PATH,
  }

  shutdownInfra()
  process.env.CRADLE_DATA_DIR = dataDir
  delete process.env.CRADLE_DB_PATH
  return previous
}

function restoreTestInfra(previous: TestInfraEnv): void {
  shutdownInfra()
  if (previous.dataDir === undefined) {
    delete process.env.CRADLE_DATA_DIR
  }
  else {
    process.env.CRADLE_DATA_DIR = previous.dataDir
  }

  if (previous.dbPath === undefined) {
    delete process.env.CRADLE_DB_PATH
  }
  else {
    process.env.CRADLE_DB_PATH = previous.dbPath
  }
}

function runGit(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
}

function initGitRepository(dir: string): void {
  try {
    runGit(dir, ['init', '--initial-branch=main', '--template='])
  }
 catch {
    runGit(dir, ['init', '--template='])
    runGit(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  }

  runGit(dir, ['config', 'user.name', 'Cradle Server Tests'])
  runGit(dir, ['config', 'user.email', 'server-tests@example.com'])
  runGit(dir, ['config', 'commit.gpgsign', 'false'])
}

function commitFile(dir: string, fileName: string, content: string, message: string): void {
  writeFileSync(join(dir, fileName), `${content}\n`, 'utf8')
  runGit(dir, ['add', fileName])
  runGit(dir, ['commit', '-m', message])
}

function createGitWorkspaceFixture(dir: string): void {
  initGitRepository(dir)
  commitFile(dir, '.gitignore', '.cradle/', 'repo: ignore Cradle worktrees')
  commitFile(dir, 'README.md', '# Git Fixture', 'repo: initial commit')
  commitFile(dir, 'main.txt', 'main branch content', 'main: second commit')
  runGit(dir, ['checkout', '-b', 'seed-branch'])
  commitFile(dir, 'seed.txt', 'seed branch content', 'seed: branch commit')
  runGit(dir, ['checkout', 'main'])
  commitFile(dir, 'notes.txt', 'third commit on main', 'main: third commit')
}

describe('git capability', () => {
  it('returns workspace-owned status, branches, and commit graph for a real git repository', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-git-workspace-')
    const previousEnv = useIsolatedTestInfra(dataDir)

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      createGitWorkspaceFixture(workspaceRoot)
      app = await createServerApp()
      db()
        .insert(workspaces)
        .values(workspaceFixture({
          id: 'workspace-git',
          name: 'Workspace Git',
          path: workspaceRoot,
        }))
        .run()

      const statusRes = await app.handle(
        new Request('http://localhost/workspaces/workspace-git/git/status'),
      )
      expect(statusRes.status).toBe(200)
      expect(await statusRes.json()).toEqual(
        expect.objectContaining<Partial<GitStatus>>({
          branch: 'main',
          isDetached: false,
          files: [],
        }),
      )

      writeFileSync(join(workspaceRoot, 'src.test.ts'), 'test file\n', 'utf8')
      writeFileSync(join(workspaceRoot, 'notes.txt'), 'changed notes\n', 'utf8')
      unlinkSync(join(workspaceRoot, 'main.txt'))

      const statusWithChangesRes = await app.handle(
        new Request('http://localhost/workspaces/workspace-git/git/status'),
      )
      expect(statusWithChangesRes.status).toBe(200)
      const statusWithChanges = (await statusWithChangesRes.json()) as GitStatus
      expect(statusWithChanges.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'main.txt', workspacePath: 'main.txt', status: 'deleted' }),
          expect.objectContaining({ path: 'notes.txt', workspacePath: 'notes.txt', status: 'modified' }),
          expect.objectContaining({ path: 'src.test.ts', workspacePath: 'src.test.ts', status: 'untracked' }),
        ]),
      )

      const diffRes = await app.handle(
        new Request('http://localhost/workspaces/workspace-git/git/diff'),
      )
      expect(diffRes.status).toBe(200)
      const diff = await diffRes.text()
      expect(diff).toContain('diff --git a/main.txt b/main.txt')
      expect(diff).toContain('deleted file mode')
      expect(diff).toContain('diff --git a/notes.txt b/notes.txt')
      expect(diff).toContain('diff --git a/src.test.ts b/src.test.ts')
      expect(diff).toContain('new file mode')

      const untrackedDiffRes = await app.handle(
        new Request('http://localhost/workspaces/workspace-git/git/diff?paths=src.test.ts'),
      )
      expect(untrackedDiffRes.status).toBe(200)
      const untrackedDiff = await untrackedDiffRes.text()
      expect(untrackedDiff).toContain('diff --git a/src.test.ts b/src.test.ts')
      expect(untrackedDiff).not.toContain('diff --git a/notes.txt b/notes.txt')

      const branchesRes = await app.handle(
        new Request('http://localhost/workspaces/workspace-git/git/branches'),
      )
      expect(branchesRes.status).toBe(200)
      const branches = (await branchesRes.json()) as GitBranches
      expect(branches.local).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'main', isCurrent: true }),
          expect.objectContaining({ name: 'seed-branch', isCurrent: false }),
        ]),
      )

      const graphRes = await app.handle(
        new Request('http://localhost/workspaces/workspace-git/git/graph?limit=100'),
      )
      expect(graphRes.status).toBe(200)
      const graph = (await graphRes.json()) as GitGraphCommit[]
      expect(graph.map(commit => commit.subject)).toEqual(
        expect.arrayContaining(['main: third commit', 'seed: branch commit']),
      )
      expect(graph[0]?.shortSha.length).toBe(7)
    }
 finally {
      restoreTestInfra(previousEnv)
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('creates-and-switches a new branch and supports checkout of an existing branch', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-git-workspace-')
    const previousEnv = useIsolatedTestInfra(dataDir)

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      createGitWorkspaceFixture(workspaceRoot)
      app = await createServerApp()
      db()
        .insert(workspaces)
        .values(workspaceFixture({
          id: 'workspace-git',
          name: 'Workspace Git',
          path: workspaceRoot,
        }))
        .run()

      const createBranchRes = await app.handle(
        new Request('http://localhost/workspaces/workspace-git/git/branches', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'feature/http-git' }),
        }),
      )
      expect(createBranchRes.status).toBe(200)
      expect(await createBranchRes.json()).toEqual({ ok: true })

      const statusAfterCreateRes = await app.handle(
        new Request('http://localhost/workspaces/workspace-git/git/status'),
      )
      const statusAfterCreate = (await statusAfterCreateRes.json()) as GitStatus
      expect(statusAfterCreate.branch).toBe('feature/http-git')
      expect(runGit(workspaceRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('feature/http-git')

      const checkoutRes = await app.handle(
        new Request('http://localhost/workspaces/workspace-git/git/checkout', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ branch: 'seed-branch' }),
        }),
      )
      expect(checkoutRes.status).toBe(200)
      expect(await checkoutRes.json()).toEqual({ ok: true })

      const statusAfterCheckoutRes = await app.handle(
        new Request('http://localhost/workspaces/workspace-git/git/status'),
      )
      const statusAfterCheckout = (await statusAfterCheckoutRes.json()) as GitStatus
      expect(statusAfterCheckout.branch).toBe('seed-branch')
      expect(runGit(workspaceRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('seed-branch')
    }
 finally {
      restoreTestInfra(previousEnv)
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('discovers and scopes independent child repositories in one workspace', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-multi-git-workspace-')
    const repoA = join(workspaceRoot, 'repo-a')
    const repoB = join(workspaceRoot, 'repo-b')
    const previousEnv = useIsolatedTestInfra(dataDir)

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      mkdirSync(repoA)
      mkdirSync(repoB)
      initGitRepository(repoA)
      initGitRepository(repoB)
      commitFile(repoA, 'alpha.txt', 'alpha original', 'repo-a: initial commit')
      commitFile(repoB, 'beta.txt', 'beta original', 'repo-b: initial commit')
      writeFileSync(join(repoA, 'alpha.txt'), 'alpha changed\n', 'utf8')
      writeFileSync(join(repoB, 'beta.txt'), 'beta changed\n', 'utf8')
      writeFileSync(join(repoB, 'scratch.txt'), 'scratch\n', 'utf8')

      app = await createServerApp()
      db()
        .insert(workspaces)
        .values(workspaceFixture({
          id: 'workspace-multi-git',
          name: 'Workspace Multi Git',
          path: workspaceRoot,
        }))
        .run()

      const repositoriesRes = await app.handle(
        new Request('http://localhost/workspaces/workspace-multi-git/git/repositories'),
      )
      expect(repositoriesRes.status).toBe(200)
      const repositories = (await repositoriesRes.json()) as GitRepository[]
      expect(repositories.map(repository => repository.path)).toEqual(['repo-a', 'repo-b'])
      expect(repositories.find(repository => repository.path === 'repo-a')?.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'alpha.txt',
            workspacePath: 'repo-a/alpha.txt',
            status: 'modified',
          }),
        ]),
      )
      expect(repositories.find(repository => repository.path === 'repo-b')?.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'beta.txt',
            workspacePath: 'repo-b/beta.txt',
            status: 'modified',
          }),
          expect.objectContaining({
            path: 'scratch.txt',
            workspacePath: 'repo-b/scratch.txt',
            status: 'untracked',
          }),
        ]),
      )

      const ambiguousStatusRes = await app.handle(
        new Request('http://localhost/workspaces/workspace-multi-git/git/status'),
      )
      expect(ambiguousStatusRes.status).toBe(409)
      expect((await ambiguousStatusRes.json()).code).toBe('git_repository_required')

      const repoAStatusRes = await app.handle(
        new Request('http://localhost/workspaces/workspace-multi-git/git/status?repo=repo-a'),
      )
      expect(repoAStatusRes.status).toBe(200)
      const repoAStatus = (await repoAStatusRes.json()) as GitStatus
      expect(repoAStatus.repositoryPath).toBe('repo-a')
      expect(repoAStatus.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'alpha.txt',
            workspacePath: 'repo-a/alpha.txt',
            status: 'modified',
          }),
        ]),
      )
      expect(repoAStatus.files).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ workspacePath: 'repo-b/beta.txt' }),
        ]),
      )

      const repoADiffRes = await app.handle(
        new Request('http://localhost/workspaces/workspace-multi-git/git/diff?repo=repo-a&paths=alpha.txt'),
      )
      expect(repoADiffRes.status).toBe(200)
      const repoADiff = await repoADiffRes.text()
      expect(repoADiff).toContain('diff --git a/alpha.txt b/alpha.txt')
      expect(repoADiff).toContain('alpha changed')
      expect(repoADiff).not.toContain('beta changed')

      const missingRepoDiffRes = await app.handle(
        new Request('http://localhost/workspaces/workspace-multi-git/git/diff?repo=repo-c'),
      )
      expect(missingRepoDiffRes.status).toBe(404)
      expect((await missingRepoDiffRes.json()).code).toBe('git_repository_not_found')
    }
 finally {
      restoreTestInfra(previousEnv)
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('returns structured errors for missing workspaces and non-git directories', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const plainWorkspaceRoot = makeTempDir('cradle-plain-workspace-')
    const previousEnv = useIsolatedTestInfra(dataDir)

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db()
        .insert(workspaces)
        .values(workspaceFixture({
          id: 'workspace-plain',
          name: 'Workspace Plain',
          path: plainWorkspaceRoot,
        }))
        .run()

      const missingWorkspace = await app.handle(
        new Request('http://localhost/workspaces/missing/git/status'),
      )
      expect(missingWorkspace.status).toBe(404)
      expect((await missingWorkspace.json()).code).toBe('workspace_not_found')

      const nonGitWorkspace = await app.handle(
        new Request('http://localhost/workspaces/workspace-plain/git/status'),
      )
      expect(nonGitWorkspace.status).toBe(409)
      expect((await nonGitWorkspace.json()).code).toBe('git_repository_unavailable')
    }
 finally {
      restoreTestInfra(previousEnv)
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(plainWorkspaceRoot, { recursive: true, force: true })
    }
  })

  it('creates, lists, and removes git worktrees with stash migration', async () => {
    const repoRoot = mkdtempSync(join(process.cwd(), '.test-git-worktree-'))
    createGitWorkspaceFixture(repoRoot)

    const worktreePath = join(repoRoot, '.cradle', 'worktrees', 'abc12345-test')
    const branch = 'cradle/wt/abc12345-test'
    const baseRef = await getHeadSha(repoRoot)

    await addGitWorktree({
      repoPath: repoRoot,
      worktreePath,
      branch,
      baseRef,
    })

    const entries = await listGitWorktrees(repoRoot)
    expect(entries.some(entry => entry.path === worktreePath && entry.branch === branch)).toBe(true)

    writeFileSync(join(repoRoot, 'dirty.txt'), 'dirty on main\n', 'utf8')
    expect(await isWorkingTreeDirty(repoRoot)).toBe(true)

    const migration = await stashAndPopAcrossCheckouts({
      mainRepoPath: repoRoot,
      worktreePath,
      message: 'cradle-test-migration',
    })
    expect(migration.conflict).toBe(false)
    expect(await isWorkingTreeDirty(repoRoot)).toBe(false)
    expect(await isWorkingTreeDirty(worktreePath)).toBe(true)

    await removeGitWorktree({ repoPath: repoRoot, worktreePath, force: true })
    const afterRemove = await listGitWorktrees(repoRoot)
    expect(afterRemove.some(entry => entry.path === worktreePath)).toBe(false)

    rmSync(repoRoot, { recursive: true, force: true })
  })
})
