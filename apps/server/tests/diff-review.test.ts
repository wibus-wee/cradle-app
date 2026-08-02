import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  agents,
  providerTargets,
  sessions,
  workspaces,
} from '@cradle/db'
import type { UIMessageChunk } from 'ai'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import { resetTokenCache } from '../src/lib/github-api'
import { getRuntimeRegistry, registerRuntime } from '../src/modules/chat-runtime/chat-runtime-provider-registry'
import type {
  ChatRuntime,
  ChatRuntimeCapabilities,
  ChatRuntimeMetadata,
  ResumeChatSessionInput,
  RuntimeSession,
  StartChatSessionInput,
  StreamTurnInput,
} from '../src/modules/chat-runtime/runtime-provider-types'

const TEST_DIFF_REVIEW_RUNTIME_METADATA = {
  label: 'Diff Review Test Runtime',
  providerKinds: ['openai-compatible'],
} satisfies ChatRuntimeMetadata

const TEST_DIFF_REVIEW_RUNTIME_CAPABILITIES = {
  steer: 'queue-fallback',
  supportsShellExecution: false,
  supportsLastTurnRollback: false,
  supportsRuntimeSettings: false,
  supportsUiSlotStates: false,
  supportsDynamicCapabilities: false,
  supportsTitleGeneration: false,
  sessionModelSwitch: 'in-session',
} satisfies ChatRuntimeCapabilities

function localWorkspaceRow(input: { id: string, name: string, path: string }) {
  return {
    ...input,
    locatorJson: JSON.stringify({ hostId: 'local', path: input.path }),
  }
}

class TestDiffReviewRuntime implements ChatRuntime {
  readonly runtimeKind = 'standard' as const
  readonly metadata = TEST_DIFF_REVIEW_RUNTIME_METADATA
  readonly capabilities = TEST_DIFF_REVIEW_RUNTIME_CAPABILITIES
  readonly streamInputs: StreamTurnInput[] = []
  responseText = 'Applied review feedback.'
  blockNextRun = false
  private releaseBlockedRun: (() => void) | null = null

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: input.profile.providerTargetId,
      runtimeKind: 'standard',
      providerSessionId: `diff-review-test-${input.chatSessionId}`,
      providerStateSnapshot: input.previousProviderStateSnapshot ?? null,
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    return input.runtimeSession
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    this.streamInputs.push(input)
    yield { type: 'text-start', id: 'diff-review-agent-fix' }
    if (this.blockNextRun) {
      this.blockNextRun = false
      await new Promise<void>((resolve) => {
        this.releaseBlockedRun = resolve
      })
    }
    yield { type: 'text-delta', id: 'diff-review-agent-fix', delta: this.responseText }
    yield { type: 'text-end', id: 'diff-review-agent-fix' }
    yield { type: 'finish', finishReason: 'stop' }
  }

  releaseRun(): void {
    this.releaseBlockedRun?.()
    this.releaseBlockedRun = null
  }

  async cancelTurn(): Promise<void> {
    this.releaseRun()
  }
}

interface DiffReviewResponse {
  id: string
  workspaceId: string
  repositoryPath: string
  sourceKind: 'local-working-tree' | 'local-branch-compare' | 'local-commit' | 'github-pull-request'
  githubPullRequest: { owner: string, repo: string, number: number } | null
  title: string
  status: 'open' | 'merged' | 'closed' | 'abandoned'
  reviewState: 'unreviewed' | 'in-review' | 'changes-requested' | 'approved' | 'commented'
  currentRevisionId: string | null
  currentRevision: {
    id: string
    sourceVersion: string
    patchHash: string
    fileCount: number
    additions: number
    deletions: number
    patch: string
  } | null
  files: Array<{
    id: string
    path: string
    status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'
    additions: number
    deletions: number
    isGenerated: boolean
    isBinary: boolean
    isViewed: boolean
  }>
  threads: Array<{
    id: string
    currentRevisionId: string | null
    fileId: string | null
    anchor: {
      revisionId: string
      fileId: string
      path: string
      side: 'base' | 'head'
      startLine: number
      endLine: number
      lineHash: string
      hunkHeader: string
    } | null
    state: 'open' | 'resolved' | 'stale'
    comments: Array<{ bodyMarkdown: string }>
  }>
  submissions: Array<{
    decision: 'approve' | 'request-changes' | 'comment'
    sourceSyncState: 'local-only' | 'pending' | 'synced' | 'failed'
  }>
  events: Array<{
    eventKind: string
    payload: unknown
  }>
  preferences: {
    diffStyle: 'split' | 'unified'
    fontSize: number
  }
  agentFixes: Array<{
    id: string
    instruction: string
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
    sessionId: string | null
    runId: string | null
    profileId: string | null
    artifactId: string | null
    resultRevisionId: string | null
  }>
}

interface TestInfraEnv {
  dataDir?: string
  dbPath?: string
  migrationsDir?: string
  runWaitTimeout?: string
}

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function useIsolatedTestInfra(dataDir: string): TestInfraEnv {
  const previous = {
    dataDir: process.env.CRADLE_DATA_DIR,
    dbPath: process.env.CRADLE_DB_PATH,
    migrationsDir: process.env.CRADLE_MIGRATIONS_DIR,
    runWaitTimeout: process.env.CRADLE_CHAT_RUN_WAIT_TIMEOUT_MS,
  }

  shutdownInfra()
  process.env.CRADLE_DATA_DIR = dataDir
  process.env.CRADLE_MIGRATIONS_DIR = resolve(process.cwd(), '../../packages/db/drizzle')
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

  if (previous.migrationsDir === undefined) {
    delete process.env.CRADLE_MIGRATIONS_DIR
  }
  else {
    process.env.CRADLE_MIGRATIONS_DIR = previous.migrationsDir
  }

  if (previous.runWaitTimeout === undefined) {
    delete process.env.CRADLE_CHAT_RUN_WAIT_TIMEOUT_MS
  }
  else {
    process.env.CRADLE_CHAT_RUN_WAIT_TIMEOUT_MS = previous.runWaitTimeout
  }
}

function runGit(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
}

function initGitRepository(dir: string): void {
  try {
    runGit(dir, ['init', '--initial-branch=main'])
  }
  catch {
    runGit(dir, ['init'])
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

async function refreshLocalReview(app: Awaited<ReturnType<typeof createServerApp>>, workspaceId: string): Promise<DiffReviewResponse> {
  const response = await app.handle(
    new Request(`http://localhost/workspaces/${workspaceId}/diff-reviews/local-working-tree`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }),
  )
  expect(response.status).toBe(200)
  return await response.json() as DiffReviewResponse
}

async function postJson<T>(
  app: Awaited<ReturnType<typeof createServerApp>>,
  path: string,
  body: unknown,
): Promise<T> {
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  expect(response.status).toBe(200)
  return await response.json() as T
}

async function postJsonWithStatus<T>(
  app: Awaited<ReturnType<typeof createServerApp>>,
  path: string,
  body: unknown,
  status: number,
): Promise<T> {
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  expect(response.status).toBe(status)
  return await response.json() as T
}

async function putJson<T>(
  app: Awaited<ReturnType<typeof createServerApp>>,
  path: string,
  body: unknown,
): Promise<T> {
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  expect(response.status).toBe(200)
  return await response.json() as T
}

async function getJson<T>(
  app: Awaited<ReturnType<typeof createServerApp>>,
  path: string,
): Promise<T> {
  const response = await app.handle(new Request(`http://localhost${path}`))
  expect(response.status).toBe(200)
  return await response.json() as T
}

async function waitForCondition<T>(read: () => Promise<T | null>, description: string): Promise<T> {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const value = await read()
    if (value) {
      return value
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for ${description}`)
}

describe('diff-review capability', () => {
  it('materializes a GitHub pull request as a refreshable review source', { timeout: 30_000 }, async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-diff-review-github-workspace-')
    const previousEnv = useIsolatedTestInfra(dataDir)
    const previousGitHubToken = process.env.GH_TOKEN

    try {
      process.env.GH_TOKEN = 'test-token'
      resetTokenCache()
      const pullRequest = {
        number: 70,
        node_id: 'PR_70',
        title: 'Complete remote review flow',
        body: null,
        state: 'open',
        draft: false,
        merged: false,
        mergeable: true,
        mergeable_state: 'clean',
        html_url: 'https://github.com/cradle/app/pull/70',
        user: { login: 'author', avatar_url: 'https://avatars.example/author', html_url: 'https://github.com/author' },
        head: { sha: 'head-sha', ref: 'feature/remote-review' },
        base: { ref: 'main' },
        additions: 4,
        deletions: 1,
        changed_files: 2,
        commits: 1,
        comments: 0,
        review_comments: 0,
        created_at: '2026-07-20T10:00:00Z',
        updated_at: '2026-07-21T10:00:00Z',
        closed_at: null,
        merged_at: null,
        requested_reviewers: [],
        assignees: [],
        labels: [],
      }
      const files = [{
        sha: 'file-sha',
        filename: 'src/app.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
        changes: 2,
        blob_url: 'https://github.com/cradle/app/blob/head/src/app.ts',
        raw_url: 'https://raw.githubusercontent.com/cradle/app/head/src/app.ts',
        contents_url: 'https://api.github.com/repos/cradle/app/contents/src/app.ts',
        patch: '@@ -1 +1 @@\n-export const local = true\n+export const remote = true',
        previous_filename: null,
      }, {
        sha: 'large-file-sha',
        filename: 'src/generated.ts',
        status: 'added',
        additions: 3,
        deletions: 0,
        changes: 3,
        blob_url: 'https://github.com/cradle/app/blob/head/src/generated.ts',
        raw_url: 'https://raw.githubusercontent.com/cradle/app/head/src/generated.ts',
        contents_url: 'https://api.github.com/repos/cradle/app/contents/src/generated.ts',
        patch: null,
        previous_filename: null,
      }]
      const remoteComment = {
        id: 'PRRC_imported',
        body: 'Imported from GitHub.',
        url: 'https://github.com/cradle/app/pull/70#discussion_r1',
        createdAt: '2026-07-21T10:00:00Z',
        updatedAt: '2026-07-21T10:00:00Z',
        author: { login: 'reviewer' },
      }
      const importedThread = {
        id: 'PRRT_imported',
        isResolved: false,
        isOutdated: false,
        path: 'src/app.ts',
        line: 1,
        startLine: null,
        diffSide: 'RIGHT',
        startDiffSide: null,
        comments: { nodes: [remoteComment] },
      }
      const createdComment = {
        ...remoteComment,
        id: 'PRRC_created',
        body: 'Created from Cradle.',
        url: 'https://github.com/cradle/app/pull/70#discussion_r2',
        author: { login: 'local-user' },
      }
      const createdThread = {
        ...importedThread,
        id: 'PRRT_created',
        comments: { nodes: [createdComment] },
      }
      const repliedThread = {
        ...createdThread,
        comments: {
          nodes: [
            createdComment,
            {
              ...createdComment,
              id: 'PRRC_reply',
              body: 'Reply from Cradle.',
              url: 'https://github.com/cradle/app/pull/70#discussion_r3',
              updatedAt: '2026-07-21T10:01:00Z',
            },
          ],
        },
      }
      const reviewThreadsPayload = {
        data: {
          repository: {
            pullRequest: {
              id: 'PR_70',
              reviewThreads: {
                nodes: [importedThread],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      }
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = (init?.method ?? 'GET').toUpperCase()
        const body = typeof init?.body === 'string' ? init.body : ''

        if (url.includes('/graphql')) {
          if (body.includes('addPullRequestReviewThreadReply')) {
            return new Response(JSON.stringify({
              data: { addPullRequestReviewThreadReply: { thread: repliedThread } },
            }), { status: 200 })
          }
          if (body.includes('addPullRequestReviewThread')) {
            return new Response(JSON.stringify({
              data: { addPullRequestReviewThread: { thread: createdThread } },
            }), { status: 200 })
          }
          if (body.includes('resolveReviewThread')) {
            return new Response(JSON.stringify({
              data: { resolveReviewThread: { thread: { ...repliedThread, isResolved: true } } },
            }), { status: 200 })
          }
          return new Response(JSON.stringify(reviewThreadsPayload), { status: 200 })
        }
        if (method === 'POST' && url.endsWith('/pulls/70/reviews')) {
          return new Response(JSON.stringify({
            id: 9001,
            state: 'APPROVED',
            html_url: 'https://github.com/cradle/app/pull/70#pullrequestreview-9001',
          }), { status: 200 })
        }
        if (url.includes('/pulls/70/reviews')) {
          return new Response(JSON.stringify([]), { status: 200 })
        }
        if (url.includes('/pulls/70/files')) {
          return new Response(JSON.stringify(files), { status: 200 })
        }
        if (url.includes('/issues/70/comments')) {
          return new Response(JSON.stringify([]), { status: 200 })
        }
        if (url.includes('/pulls/70')) {
          return new Response(JSON.stringify(pullRequest), { status: 200 })
        }
        if (url.includes('/check-runs')) {
          return new Response(JSON.stringify({ total_count: 0, check_runs: [] }), { status: 200 })
        }
        if (url.includes('/commits/') && url.includes('/status')) {
          return new Response(JSON.stringify({ state: 'success', total_count: 0, statuses: [] }), { status: 200 })
        }
        if (url.includes('/repos/cradle/app') && !url.includes('/pulls/') && !url.includes('/commits/')) {
          return new Response(JSON.stringify({
            allow_merge_commit: true,
            allow_squash_merge: true,
            allow_rebase_merge: true,
          }), { status: 200 })
        }
        return new Response(JSON.stringify({ message: `unmocked ${method} ${url}` }), { status: 404 })
      })
      vi.stubGlobal('fetch', fetchMock)

      const app = await createServerApp()
      db()
        .insert(workspaces)
        .values(localWorkspaceRow({
          id: 'workspace-diff-review-github',
          name: 'Workspace Diff Review GitHub',
          path: workspaceRoot,
        }))
        .run()

      const review = await postJson<DiffReviewResponse>(
        app,
        '/workspaces/workspace-diff-review-github/diff-reviews/github-pull-request',
        { owner: 'cradle', repo: 'app', number: 70 },
      )

      expect(review.sourceKind).toBe('github-pull-request')
      expect(review.githubPullRequest).toMatchObject({
        owner: 'cradle',
        repo: 'app',
        number: 70,
        detail: {
          isDraft: false,
          headRef: 'feature/remote-review',
          baseRef: 'main',
          checksState: 'neutral',
          author: { login: 'author' },
        },
      })
      expect(review.repositoryPath).toBe('github:cradle/app')
      expect(review.status).toBe('open')
      expect(review.currentRevision).toMatchObject({
        sourceVersion: expect.stringContaining('head-sha:'),
        fileCount: 2,
        additions: 4,
        deletions: 1,
      })
      expect(review.files).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'src/app.ts', status: 'modified', additions: 1, deletions: 1 }),
        expect.objectContaining({ path: 'src/generated.ts', status: 'added', additions: 3, deletions: 0, isBinary: false }),
      ]))
      expect(review.threads).toEqual([
        expect.objectContaining({
          id: 'github-review-thread:PRRT_imported',
          state: 'open',
          createdBy: 'reviewer',
          comments: [expect.objectContaining({
            id: 'github-review-comment:PRRC_imported',
            authorKind: 'external',
            externalUrl: remoteComment.url,
          })],
        }),
      ])
      expect(fetchMock).toHaveBeenCalled()
      const initialCallCount = fetchMock.mock.calls.length
      expect(initialCallCount).toBeGreaterThanOrEqual(7)

      const appFile = review.files.find(file => file.path === 'src/app.ts')!
      const created = await postJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-github/diff-reviews/${review.id}/threads`,
        {
          fileId: appFile.id,
          anchor: { fileId: appFile.id, side: 'head', startLine: 1, endLine: 1 },
          bodyMarkdown: 'Created from Cradle.',
        },
      )
      expect(created.threads).toHaveLength(2)
      expect(created.threads.at(-1)).toMatchObject({
        id: 'github-review-thread:PRRT_created',
        comments: [expect.objectContaining({ bodyMarkdown: 'Created from Cradle.' })],
      })
      expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCallCount)

      const replied = await postJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-github/diff-reviews/${review.id}/threads/github-review-thread:PRRT_created/comments`,
        { bodyMarkdown: 'Reply from Cradle.' },
      )
      expect(replied.threads.at(-1)?.comments).toHaveLength(2)

      const resolved = await postJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-github/diff-reviews/${review.id}/threads/github-review-thread:PRRT_created/resolve`,
        {},
      )
      expect(resolved.threads.at(-1)?.state).toBe('resolved')

      const missingBody = await postJsonWithStatus<{ code: string }>(
        app,
        `/workspaces/workspace-diff-review-github/diff-reviews/${review.id}/submit`,
        { decision: 'request-changes' },
        400,
      )
      expect(missingBody.code).toBe('diff_review_github_body_required')

      const submitted = await postJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-github/diff-reviews/${review.id}/submit`,
        { decision: 'approve', bodyMarkdown: 'Ready to merge.' },
      )
      expect(submitted.reviewState).toBe('approved')
      expect(submitted.submissions[0]).toMatchObject({
        decision: 'approve',
        sourceSyncState: 'synced',
      })
      const reviewSubmitCall = fetchMock.mock.calls.find((call) => {
        const url = String(call[0] ?? '')
        const init = call[1] as RequestInit | undefined
        return url.endsWith('/pulls/70/reviews') && (init?.method ?? 'GET').toUpperCase() === 'POST'
      })
      expect(reviewSubmitCall).toBeTruthy()
      expect(reviewSubmitCall?.[0]).toBe('https://api.github.com/repos/cradle/app/pulls/70/reviews')
      expect(reviewSubmitCall?.[1]).toMatchObject({ method: 'POST' })
      expect(JSON.parse(String((reviewSubmitCall?.[1] as RequestInit | undefined)?.body))).toEqual({
        body: 'Ready to merge.',
        event: 'APPROVE',
      })

      const closeError = await postJsonWithStatus<{ code: string }>(
        app,
        `/workspaces/workspace-diff-review-github/diff-reviews/${review.id}/close`,
        {},
        400,
      )
      expect(closeError.code).toBe('diff_review_remote_pull_request_cannot_close')
    }
    finally {
      if (previousGitHubToken === undefined) {
        delete process.env.GH_TOKEN
      }
      else {
        process.env.GH_TOKEN = previousGitHubToken
      }
      resetTokenCache()
      vi.unstubAllGlobals()
      restoreTestInfra(previousEnv)
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('creates and refreshes an immutable local working tree revision', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-diff-review-workspace-')
    const previousEnv = useIsolatedTestInfra(dataDir)

    try {
      initGitRepository(workspaceRoot)
      commitFile(workspaceRoot, 'README.md', '# Diff Review Fixture', 'repo: initial commit')
      writeFileSync(join(workspaceRoot, 'README.md'), '# Diff Review Fixture\nchanged\n', 'utf8')
      writeFileSync(join(workspaceRoot, 'new-file.ts'), 'export const value = 1\n', 'utf8')
      writeFileSync(join(workspaceRoot, 'schema.gen.ts'), 'export const schema = {}\n', 'utf8')

      const app = await createServerApp()
      db()
        .insert(workspaces)
        .values(localWorkspaceRow({
          id: 'workspace-diff-review',
          name: 'Workspace Diff Review',
          path: workspaceRoot,
        }))
        .run()

      const first = await refreshLocalReview(app, 'workspace-diff-review')
      expect(first.workspaceId).toBe('workspace-diff-review')
      expect(first.repositoryPath).toBe('.')
      expect(first.sourceKind).toBe('local-working-tree')
      expect(first.currentRevision).not.toBeNull()
      expect(first.currentRevision?.fileCount).toBe(3)
      expect(first.currentRevision?.patch).toContain('diff --git a/README.md b/README.md')
      expect(first.currentRevision?.patch).toContain('diff --git a/new-file.ts b/new-file.ts')
      expect(first.currentRevision?.patch).toContain('diff --git a/schema.gen.ts b/schema.gen.ts')
      expect(first.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ eventKind: 'review_created' }),
          expect.objectContaining({ eventKind: 'revision_updated' }),
        ]),
      )
      expect(first.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'README.md', status: 'modified' }),
          expect.objectContaining({ path: 'new-file.ts', status: 'untracked' }),
          expect.objectContaining({ path: 'schema.gen.ts', status: 'untracked', isGenerated: true }),
        ]),
      )

      const second = await refreshLocalReview(app, 'workspace-diff-review')
      expect(second.id).toBe(first.id)
      expect(second.currentRevision?.id).toBe(first.currentRevision?.id)
      expect(second.currentRevision?.patchHash).toBe(first.currentRevision?.patchHash)

      writeFileSync(join(workspaceRoot, 'new-file.ts'), 'export const value = 2\n', 'utf8')
      const third = await refreshLocalReview(app, 'workspace-diff-review')
      expect(third.id).toBe(first.id)
      expect(third.currentRevision?.id).not.toBe(first.currentRevision?.id)
      expect(third.currentRevision?.patchHash).not.toBe(first.currentRevision?.patchHash)
    }
    finally {
      restoreTestInfra(previousEnv)
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('persists local review lifecycle state end to end', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-diff-review-workspace-')
    const previousEnv = useIsolatedTestInfra(dataDir)

    try {
      initGitRepository(workspaceRoot)
      commitFile(workspaceRoot, 'README.md', '# Diff Review Fixture', 'repo: initial commit')
      writeFileSync(join(workspaceRoot, 'README.md'), '# Diff Review Fixture\nchanged\n', 'utf8')
      writeFileSync(join(workspaceRoot, 'app.ts'), 'export const changed = true\n', 'utf8')

      const app = await createServerApp()
      db()
        .insert(workspaces)
        .values(localWorkspaceRow({
          id: 'workspace-diff-review-lifecycle',
          name: 'Workspace Diff Review Lifecycle',
          path: workspaceRoot,
        }))
        .run()

      const review = await refreshLocalReview(app, 'workspace-diff-review-lifecycle')
      const file = review.files.find(item => item.path === 'README.md')
      expect(file).toBeTruthy()

      const viewed = await postJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-lifecycle/diff-reviews/${review.id}/files/${file!.id}/viewed`,
        { viewed: true },
      )
      expect(viewed.files.find(item => item.id === file!.id)?.isViewed).toBe(true)

      const threaded = await postJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-lifecycle/diff-reviews/${review.id}/threads`,
        { fileId: file!.id, bodyMarkdown: 'Please check this change.' },
      )
      expect(threaded.reviewState).toBe('in-review')
      expect(threaded.threads).toHaveLength(1)
      expect(threaded.threads[0]?.comments[0]?.bodyMarkdown).toBe('Please check this change.')

      const threadId = threaded.threads[0]!.id
      const replied = await postJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-lifecycle/diff-reviews/${review.id}/threads/${threadId}/comments`,
        { bodyMarkdown: 'Follow-up note.' },
      )
      expect(replied.threads[0]?.comments).toHaveLength(2)

      const resolved = await postJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-lifecycle/diff-reviews/${review.id}/threads/${threadId}/resolve`,
        {},
      )
      expect(resolved.threads[0]?.state).toBe('resolved')

      const submitted = await postJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-lifecycle/diff-reviews/${review.id}/submit`,
        { decision: 'request-changes', bodyMarkdown: 'Needs one more pass.' },
      )
      expect(submitted.reviewState).toBe('changes-requested')
      expect(submitted.submissions[0]).toMatchObject({
        decision: 'request-changes',
        sourceSyncState: 'local-only',
      })

      const preferences = await putJson<{ diffStyle: 'split' | 'unified', fontSize: number }>(
        app,
        '/workspaces/workspace-diff-review-lifecycle/diff-reviews/preferences',
        { diffStyle: 'unified', fontSize: 13 },
      )
      expect(preferences).toMatchObject({ diffStyle: 'unified', fontSize: 13 })

      const agentFix = await postJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-lifecycle/diff-reviews/${review.id}/agent-fixes`,
        {
          threadId,
          instruction: 'Fix the requested change.',
          expectedOutput: 'working-tree-change',
        },
      )
      expect(agentFix.agentFixes[0]).toMatchObject({
        instruction: 'Fix the requested change.',
        status: 'pending',
      })

      const closeError = await postJsonWithStatus<{ code: string }>(
        app,
        `/workspaces/workspace-diff-review-lifecycle/diff-reviews/${review.id}/close`,
        {},
        400,
      )
      expect(closeError.code).toBe('diff_review_live_working_tree_cannot_close')

      const readiness = await getJson<Array<{ sourceKind: string, state: string }>>(
        app,
        '/workspaces/workspace-diff-review-lifecycle/diff-reviews/source-readiness',
      )
      expect(readiness).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sourceKind: 'local-working-tree', state: 'ready' }),
          expect.objectContaining({ sourceKind: 'github-pull-request', state: 'ready' }),
        ]),
      )

      const reloaded = await getJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-lifecycle/diff-reviews/${review.id}`,
      )
      expect(reloaded.files.find(item => item.id === file!.id)?.isViewed).toBe(true)
      expect(reloaded.status).toBe('open')
      expect(reloaded.threads[0]?.state).toBe('resolved')
      expect(reloaded.preferences).toMatchObject({ diffStyle: 'unified', fontSize: 13 })
      expect(reloaded.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ eventKind: 'file_viewed' }),
          expect.objectContaining({ eventKind: 'thread_created' }),
          expect.objectContaining({ eventKind: 'thread_resolved' }),
          expect.objectContaining({ eventKind: 'review_submitted' }),
          expect.objectContaining({ eventKind: 'agent_fix_created' }),
        ]),
      )
    }
    finally {
      restoreTestInfra(previousEnv)
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('starts an agent fix run and links the completed run back to the review revision', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-diff-review-workspace-')
    const previousEnv = useIsolatedTestInfra(dataDir)
    const runtime = new TestDiffReviewRuntime()
    const originalStandardRuntime = getRuntimeRegistry().get('standard')

    try {
      registerRuntime(runtime)
      initGitRepository(workspaceRoot)
      commitFile(workspaceRoot, 'README.md', '# Diff Review Fixture', 'repo: initial commit')
      writeFileSync(join(workspaceRoot, 'README.md'), '# Diff Review Fixture\nneeds agent fix\n', 'utf8')

      const app = await createServerApp()
      const now = Math.floor(Date.now() / 1000)
      db()
        .insert(workspaces)
        .values(localWorkspaceRow({
          id: 'workspace-diff-review-agent-fix',
          name: 'Workspace Diff Review Agent Fix',
          path: workspaceRoot,
        }))
        .run()
      db().insert(providerTargets).values({
        id: 'provider-target-diff-review-agent-fix',
        kind: 'manual',
        providerKind: 'openai-compatible',
        displayName: 'Diff Review Agent Provider',
        enabled: true,
      }).run()
      db().insert(agents).values({
        id: 'agent-diff-review-fix',
        name: 'Diff Review Fix Agent',
        avatarStyle: 'bottts-neutral',
        avatarSeed: 'diff-review-fix',
        providerTargetId: 'provider-target-diff-review-agent-fix',
        runtimeKind: 'standard',
        enabled: true,
        createdAt: now,
        updatedAt: now,
      }).run()

      const review = await refreshLocalReview(app, 'workspace-diff-review-agent-fix')
      const file = review.files.find(item => item.path === 'README.md')
      expect(file).toBeTruthy()

      const threaded = await postJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-agent-fix/diff-reviews/${review.id}/threads`,
        {
          fileId: file!.id,
          anchor: { fileId: file!.id, side: 'head', startLine: 2, endLine: 2 },
          bodyMarkdown: 'Please have an agent fix this line.',
        },
      )
      const threadId = threaded.threads[0]!.id
      const created = await postJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-agent-fix/diff-reviews/${review.id}/agent-fixes`,
        {
          threadId,
          instruction: 'Update the reviewed line with clearer wording.',
          agentId: 'agent-diff-review-fix',
          expectedOutput: 'working-tree-change',
        },
      )
      const agentFix = created.agentFixes[0]!
      expect(agentFix).toMatchObject({
        profileId: 'agent-diff-review-fix',
        status: 'pending',
      })

      const started = await postJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-agent-fix/diff-reviews/${review.id}/agent-fixes/${agentFix.id}/start`,
        {},
      )
      const running = started.agentFixes.find(item => item.id === agentFix.id)
      expect(running).toMatchObject({
        status: 'running',
        sessionId: expect.any(String),
        runId: expect.any(String),
      })
      const agentFixSession = db().select().from(sessions).where(eq(sessions.id, running!.sessionId!)).get()
      expect(agentFixSession?.origin).toBe('cradle-review')
      expect(runtime.streamInputs[0]?.message.parts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: expect.stringContaining('Update the reviewed line with clearer wording.'),
          }),
        ]),
      )

      const completed = await waitForCondition(async () => {
        const reloaded = await getJson<DiffReviewResponse>(
          app,
          `/workspaces/workspace-diff-review-agent-fix/diff-reviews/${review.id}`,
        )
        const completedFix = reloaded.agentFixes.find(item => item.id === agentFix.id)
        return completedFix?.status === 'completed' ? reloaded : null
      }, 'diff review agent fix completion')
      const completedFix = completed.agentFixes.find(item => item.id === agentFix.id)
      expect(completedFix).toMatchObject({
        status: 'completed',
        artifactId: expect.stringMatching(/^diff-review-agent-fix-assistant-summary:[a-f0-9]{64}$/),
        resultRevisionId: completed.currentRevisionId,
        errorMessage: null,
      })
      const artifact = await getJson<{
        id: string
        agentFixId: string
        kind: 'patch' | 'assistant-summary'
        mimeType: string
        content: string
        contentHash: string
      }>(
        app,
        `/workspaces/workspace-diff-review-agent-fix/diff-reviews/${review.id}/agent-fixes/${agentFix.id}/artifact`,
      )
      expect(artifact).toMatchObject({
        id: completedFix?.artifactId,
        agentFixId: agentFix.id,
        kind: 'assistant-summary',
        mimeType: 'text/markdown',
        content: 'Applied review feedback.\n',
      })
      expect(completed.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ eventKind: 'agent_fix_started' }),
          expect.objectContaining({
            eventKind: 'agent_fix_completed',
            payload: expect.objectContaining({ artifactId: completedFix?.artifactId }),
          }),
        ]),
      )
    }
    finally {
      if (originalStandardRuntime) {
        registerRuntime(originalStandardRuntime)
      }
      restoreTestInfra(previousEnv)
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('cancels and reruns a diff review agent fix work order', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-diff-review-workspace-')
    const previousEnv = useIsolatedTestInfra(dataDir)
    const runtime = new TestDiffReviewRuntime()
    const originalStandardRuntime = getRuntimeRegistry().get('standard')

    try {
      registerRuntime(runtime)
      initGitRepository(workspaceRoot)
      commitFile(workspaceRoot, 'README.md', '# Diff Review Fixture', 'repo: initial commit')
      writeFileSync(join(workspaceRoot, 'README.md'), '# Diff Review Fixture\nneeds cancellable agent fix\n', 'utf8')

      const app = await createServerApp()
      const now = Math.floor(Date.now() / 1000)
      db()
        .insert(workspaces)
        .values(localWorkspaceRow({
          id: 'workspace-diff-review-agent-fix-control',
          name: 'Workspace Diff Review Agent Fix Control',
          path: workspaceRoot,
        }))
        .run()
      db().insert(providerTargets).values({
        id: 'provider-target-diff-review-agent-fix-control',
        kind: 'manual',
        providerKind: 'openai-compatible',
        displayName: 'Diff Review Agent Provider',
        enabled: true,
      }).run()
      db().insert(agents).values({
        id: 'agent-diff-review-fix-control',
        name: 'Diff Review Fix Agent',
        avatarStyle: 'bottts-neutral',
        avatarSeed: 'diff-review-fix-control',
        providerTargetId: 'provider-target-diff-review-agent-fix-control',
        runtimeKind: 'standard',
        enabled: true,
        createdAt: now,
        updatedAt: now,
      }).run()

      const review = await refreshLocalReview(app, 'workspace-diff-review-agent-fix-control')
      const file = review.files.find(item => item.path === 'README.md')
      expect(file).toBeTruthy()
      const threaded = await postJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-agent-fix-control/diff-reviews/${review.id}/threads`,
        {
          fileId: file!.id,
          anchor: { fileId: file!.id, side: 'head', startLine: 2, endLine: 2 },
          bodyMarkdown: 'Please run an agent, but allow cancellation.',
        },
      )
      const created = await postJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-agent-fix-control/diff-reviews/${review.id}/agent-fixes`,
        {
          threadId: threaded.threads[0]!.id,
          instruction: 'Make this change cancellable.',
          agentId: 'agent-diff-review-fix-control',
          expectedOutput: 'working-tree-change',
        },
      )
      const agentFix = created.agentFixes[0]!

      runtime.blockNextRun = true
      const started = await postJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-agent-fix-control/diff-reviews/${review.id}/agent-fixes/${agentFix.id}/start`,
        {},
      )
      const firstRun = started.agentFixes.find(item => item.id === agentFix.id)
      expect(firstRun).toMatchObject({
        status: 'running',
        sessionId: expect.any(String),
        runId: expect.any(String),
      })

      const cancelled = await postJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-agent-fix-control/diff-reviews/${review.id}/agent-fixes/${agentFix.id}/cancel`,
        {},
      )
      const cancelledFix = cancelled.agentFixes.find(item => item.id === agentFix.id)
      expect(cancelledFix).toMatchObject({
        status: 'cancelled',
        sessionId: firstRun!.sessionId,
        runId: firstRun!.runId,
        errorMessage: null,
      })
      expect(cancelled.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ eventKind: 'agent_fix_cancelled' }),
        ]),
      )

      const rerunning = await postJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-agent-fix-control/diff-reviews/${review.id}/agent-fixes/${agentFix.id}/rerun`,
        {},
      )
      const rerunFix = rerunning.agentFixes.find(item => item.id === agentFix.id)
      expect(rerunFix).toMatchObject({
        status: 'running',
        artifactId: null,
        resultRevisionId: null,
        errorMessage: null,
      })
      expect(rerunFix?.sessionId).not.toBe(firstRun?.sessionId)
      expect(rerunFix?.runId).not.toBe(firstRun?.runId)

      const completed = await waitForCondition(async () => {
        const reloaded = await getJson<DiffReviewResponse>(
          app,
          `/workspaces/workspace-diff-review-agent-fix-control/diff-reviews/${review.id}`,
        )
        const completedFix = reloaded.agentFixes.find(item => item.id === agentFix.id)
        return completedFix?.status === 'completed' ? reloaded : null
      }, 'diff review agent fix rerun completion')
      const completedFix = completed.agentFixes.find(item => item.id === agentFix.id)
      expect(completedFix).toMatchObject({
        status: 'completed',
        artifactId: expect.stringMatching(/^diff-review-agent-fix-assistant-summary:[a-f0-9]{64}$/),
        resultRevisionId: completed.currentRevisionId,
      })
      expect(runtime.streamInputs).toHaveLength(2)
    }
    finally {
      if (originalStandardRuntime) {
        registerRuntime(originalStandardRuntime)
      }
      restoreTestInfra(previousEnv)
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('anchors line threads and remaps or stales them across local refreshes', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-diff-review-workspace-')
    const previousEnv = useIsolatedTestInfra(dataDir)

    try {
      initGitRepository(workspaceRoot)
      commitFile(workspaceRoot, 'README.md', '# Diff Review Fixture', 'repo: initial commit')
      writeFileSync(join(workspaceRoot, 'README.md'), '# Diff Review Fixture\nstable line\n', 'utf8')

      const app = await createServerApp()
      db()
        .insert(workspaces)
        .values(localWorkspaceRow({
          id: 'workspace-diff-review-anchors',
          name: 'Workspace Diff Review Anchors',
          path: workspaceRoot,
        }))
        .run()

      const review = await refreshLocalReview(app, 'workspace-diff-review-anchors')
      const file = review.files.find(item => item.path === 'README.md')
      expect(file).toBeTruthy()

      const threaded = await postJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-anchors/diff-reviews/${review.id}/threads`,
        {
          fileId: file!.id,
          anchor: { fileId: file!.id, side: 'head', startLine: 2, endLine: 2 },
          bodyMarkdown: 'Line anchored comment.',
        },
      )
      expect(threaded.threads[0]).toMatchObject({
        state: 'open',
        currentRevisionId: review.currentRevisionId,
        anchor: expect.objectContaining({
          path: 'README.md',
          side: 'head',
          startLine: 2,
          endLine: 2,
        }),
      })
      const threadId = threaded.threads[0]!.id
      const originalLineHash = threaded.threads[0]!.anchor!.lineHash

      writeFileSync(join(workspaceRoot, 'README.md'), '# Diff Review Fixture\nstable line\nanother line\n', 'utf8')
      const remapped = await refreshLocalReview(app, 'workspace-diff-review-anchors')
      const remappedThread = remapped.threads.find(thread => thread.id === threadId)
      expect(remappedThread).toMatchObject({
        state: 'open',
        currentRevisionId: remapped.currentRevisionId,
        anchor: expect.objectContaining({
          path: 'README.md',
          side: 'head',
          startLine: 2,
          lineHash: originalLineHash,
        }),
      })

      writeFileSync(join(workspaceRoot, 'README.md'), '# Diff Review Fixture\nstable line updated\nanother line\n', 'utf8')
      const fuzzyRemapped = await refreshLocalReview(app, 'workspace-diff-review-anchors')
      const fuzzyThread = fuzzyRemapped.threads.find(thread => thread.id === threadId)
      expect(fuzzyThread).toMatchObject({
        state: 'open',
        currentRevisionId: fuzzyRemapped.currentRevisionId,
        anchor: expect.objectContaining({
          path: 'README.md',
          side: 'head',
          startLine: 2,
        }),
      })
      expect(fuzzyThread?.anchor?.lineHash).not.toBe(originalLineHash)

      writeFileSync(join(workspaceRoot, 'README.md'), '# Diff Review Fixture\n', 'utf8')
      const stale = await refreshLocalReview(app, 'workspace-diff-review-anchors')
      const staleThread = stale.threads.find(thread => thread.id === threadId)
      expect(staleThread).toMatchObject({
        state: 'stale',
        currentRevisionId: null,
      })
    }
    finally {
      restoreTestInfra(previousEnv)
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('creates an idempotent local branch compare review without checkout', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-diff-review-workspace-')
    const previousEnv = useIsolatedTestInfra(dataDir)

    try {
      initGitRepository(workspaceRoot)
      commitFile(workspaceRoot, 'README.md', '# Diff Review Fixture', 'repo: initial commit')
      runGit(workspaceRoot, ['checkout', '-b', 'feature/diffs'])
      writeFileSync(join(workspaceRoot, 'README.md'), '# Diff Review Fixture\nfeature branch\n', 'utf8')
      writeFileSync(join(workspaceRoot, 'feature.ts'), 'export const feature = true\n', 'utf8')
      runGit(workspaceRoot, ['add', 'README.md', 'feature.ts'])
      runGit(workspaceRoot, ['commit', '-m', 'feature: update fixture'])
      runGit(workspaceRoot, ['checkout', 'main'])

      const app = await createServerApp()
      db()
        .insert(workspaces)
        .values(localWorkspaceRow({
          id: 'workspace-diff-review-branch-compare',
          name: 'Workspace Diff Review Branch Compare',
          path: workspaceRoot,
        }))
        .run()

      const review = await postJson<DiffReviewResponse>(
        app,
        '/workspaces/workspace-diff-review-branch-compare/diff-reviews/local-branch-compare',
        { baseRef: 'main', headRef: 'feature/diffs' },
      )
      expect(review.sourceKind).toBe('local-branch-compare')
      expect(review.title).toBe('feature/diffs into main')
      expect(review.currentRevision?.sourceVersion).toContain('...')
      expect(review.currentRevision?.patch).toContain('diff --git a/README.md b/README.md')
      expect(review.currentRevision?.patch).toContain('diff --git a/feature.ts b/feature.ts')
      expect(review.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'README.md', status: 'modified' }),
          expect.objectContaining({ path: 'feature.ts', status: 'added' }),
        ]),
      )

      const repeated = await postJson<DiffReviewResponse>(
        app,
        '/workspaces/workspace-diff-review-branch-compare/diff-reviews/local-branch-compare',
        { baseRef: 'main', headRef: 'feature/diffs' },
      )
      expect(repeated.id).toBe(review.id)
      expect(repeated.currentRevision?.id).toBe(review.currentRevision?.id)
    }
    finally {
      restoreTestInfra(previousEnv)
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('creates an idempotent local commit review from a commit ref', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-diff-review-workspace-')
    const previousEnv = useIsolatedTestInfra(dataDir)

    try {
      initGitRepository(workspaceRoot)
      commitFile(workspaceRoot, 'README.md', '# Diff Review Fixture', 'repo: initial commit')
      writeFileSync(join(workspaceRoot, 'README.md'), '# Diff Review Fixture\ncommit review\n', 'utf8')
      writeFileSync(join(workspaceRoot, 'commit-review.ts'), 'export const reviewed = true\n', 'utf8')
      runGit(workspaceRoot, ['add', 'README.md', 'commit-review.ts'])
      runGit(workspaceRoot, ['commit', '-m', 'feature: commit review fixture'])
      const commitSha = runGit(workspaceRoot, ['rev-parse', 'HEAD'])
      const shortSha = runGit(workspaceRoot, ['rev-parse', '--short', 'HEAD'])

      const app = await createServerApp()
      db()
        .insert(workspaces)
        .values(localWorkspaceRow({
          id: 'workspace-diff-review-local-commit',
          name: 'Workspace Diff Review Local Commit',
          path: workspaceRoot,
        }))
        .run()

      const review = await postJson<DiffReviewResponse>(
        app,
        '/workspaces/workspace-diff-review-local-commit/diff-reviews/local-commit',
        { commitRef: commitSha },
      )
      expect(review.sourceKind).toBe('local-commit')
      expect(review.title).toContain(shortSha)
      expect(review.title).toContain('feature: commit review fixture')
      expect(review.currentRevision?.sourceVersion).toContain(commitSha)
      expect(review.currentRevision?.patch).toContain('diff --git a/README.md b/README.md')
      expect(review.currentRevision?.patch).toContain('diff --git a/commit-review.ts b/commit-review.ts')
      expect(review.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'README.md', status: 'modified' }),
          expect.objectContaining({ path: 'commit-review.ts', status: 'added' }),
        ]),
      )

      const repeated = await postJson<DiffReviewResponse>(
        app,
        '/workspaces/workspace-diff-review-local-commit/diff-reviews/local-commit',
        { commitRef: shortSha },
      )
      expect(repeated.id).toBe(review.id)
      expect(repeated.currentRevision?.id).toBe(review.currentRevision?.id)
    }
    finally {
      restoreTestInfra(previousEnv)
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })
})
