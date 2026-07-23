import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  agents,
  backgroundJobs,
  diffReviewCommitPlans,
  diffReviewGuides,
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
import { getRuntimeRegistry, registerRuntime, unregisterRuntime } from '../src/modules/chat-runtime/chat-runtime-provider-registry'
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

const DIFF_REVIEW_GUIDE_TEST_RUNTIME_KIND = 'diff-review-guide-test'

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

class TestDiffReviewGuideRuntime implements ChatRuntime {
  readonly runtimeKind = DIFF_REVIEW_GUIDE_TEST_RUNTIME_KIND
  readonly metadata = {
    label: 'Diff Review Guide Test Runtime',
    providerKinds: ['openai-compatible'],
    sortOrder: 5,
  } satisfies ChatRuntimeMetadata

  readonly capabilities = TEST_DIFF_REVIEW_RUNTIME_CAPABILITIES
  readonly streamInputs: StreamTurnInput[] = []
  responseText = '{"steps":[]}'
  blockNextRun = false
  private releaseBlockedRun: (() => void) | null = null

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: input.profile.providerTargetId,
      runtimeKind: DIFF_REVIEW_GUIDE_TEST_RUNTIME_KIND,
      providerSessionId: `diff-review-guide-test-${input.chatSessionId}`,
      providerStateSnapshot: input.previousProviderStateSnapshot ?? null,
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    return input.runtimeSession
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    this.streamInputs.push(input)
    yield { type: 'text-start', id: 'diff-review-guide' }
    if (this.blockNextRun) {
      this.blockNextRun = false
      await new Promise<void>((resolve) => {
        this.releaseBlockedRun = resolve
      })
    }
    yield { type: 'text-delta', id: 'diff-review-guide', delta: this.responseText }
    yield { type: 'text-end', id: 'diff-review-guide' }
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
  commitPlans: Array<{
    id: string
    strategy: 'single' | 'rule-based-groups' | 'manual'
    status: 'draft' | 'accepted' | 'applied' | 'abandoned'
    groups: Array<{
      id: string
      title: string
      message: string
      rationale: string
      fileIds: string[]
      paths: string[]
      dependsOn: string[]
    }>
  }>
  guide: {
    revisionId: string | null
    status: 'pending' | 'running' | 'ready' | 'failed' | null
    providerTargetId: string | null
    runtimeKind: string | null
    modelId: string | null
    errorMessage: string | null
    createdAt: number | null
    updatedAt: number | null
    steps: Array<{
      id: string
      title: string
      rationale: string
      fileIds: string[]
      threadIds: string[]
      anchors: Array<{
        revisionId: string
        fileId: string
        path: string
        side: 'base' | 'head'
        startLine: number
        endLine: number
        lineHash: string
        hunkHeader: string
      }>
      order: number
    }>
  }
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

function insertManualCommitPlan(review: DiffReviewResponse, input: {
  groups: Array<{
    id: string
    title: string
    message: string
    rationale: string
    paths: string[]
    dependsOn: string[]
  }>
  rationale?: string
}): string {
  if (!review.currentRevisionId) {
    throw new Error('Cannot create a manual commit plan without a current revision')
  }
  const fileByPath = new Map(review.files.map(file => [file.path, file]))
  const groups = input.groups.map(group => ({
    ...group,
    fileIds: group.paths.map((path) => {
      const file = fileByPath.get(path)
      if (!file) {
        throw new Error(`Manual commit plan references unknown review file: ${path}`)
      }
      return file.id
    }),
  }))
  const now = Math.floor(Date.now() / 1000)
  const id = randomUUID()
  db().insert(diffReviewCommitPlans).values({
    id,
    reviewId: review.id,
    revisionId: review.currentRevisionId,
    actorId: 'local-test-user',
    strategy: 'manual',
    status: 'draft',
    groupsJson: JSON.stringify(groups),
    rationale: input.rationale ?? 'Manual commit plan fixture.',
    createdAt: now,
    updatedAt: now,
  }).run()
  return id
}

describe('diff-review capability', () => {
  it('materializes a GitHub pull request as a refreshable review source', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-diff-review-github-workspace-')
    const previousEnv = useIsolatedTestInfra(dataDir)
    const previousGitHubToken = process.env.GH_TOKEN

    try {
      process.env.GH_TOKEN = 'test-token'
      resetTokenCache()
      const pullRequest = {
        number: 70,
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
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(pullRequest), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(files), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
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
        }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ total_count: 0, check_runs: [] }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'success', total_count: 0, statuses: [] }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ node_id: 'PR_70' }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          data: { addPullRequestReviewThread: { thread: createdThread } },
        }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          data: { addPullRequestReviewThreadReply: { thread: repliedThread } },
        }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          data: { resolveReviewThread: { thread: { ...repliedThread, isResolved: true } } },
        }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          id: 9001,
          state: 'APPROVED',
          html_url: 'https://github.com/cradle/app/pull/70#pullrequestreview-9001',
        }), { status: 200 }))
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
      expect(fetchMock).toHaveBeenCalledTimes(7)

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
      expect(fetchMock).toHaveBeenCalledTimes(11)

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
      expect(fetchMock).toHaveBeenCalledTimes(12)
      const [submitUrl, submitInit] = fetchMock.mock.calls[11]!
      expect(submitUrl).toBe('https://api.github.com/repos/cradle/app/pulls/70/reviews')
      expect(submitInit).toMatchObject({ method: 'POST' })
      expect(JSON.parse(String(submitInit?.body))).toEqual({
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

      const planId = insertManualCommitPlan(review, {
        rationale: 'Manual commit plan fixture for local review lifecycle.',
        groups: [
          {
            id: 'commit:implementation',
            title: 'Implementation',
            message: 'diff-review: implement local-working-tree review flow',
            rationale: 'Keep application code separate.',
            paths: ['app.ts'],
            dependsOn: [],
          },
          {
            id: 'commit:documentation',
            title: 'Documentation',
            message: 'docs: update Cradle Diffs coverage',
            rationale: 'Document the behavior after code changes land.',
            paths: ['README.md'],
            dependsOn: ['commit:implementation'],
          },
        ],
      })
      const commitPlan = await getJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-lifecycle/diff-reviews/${review.id}`,
      )
      expect(commitPlan.commitPlans[0]).toMatchObject({
        id: planId,
        strategy: 'manual',
        status: 'draft',
      })
      expect(commitPlan.commitPlans[0]?.groups).toEqual([
        expect.objectContaining({
          title: 'Implementation',
          message: 'diff-review: implement local-working-tree review flow',
          paths: ['app.ts'],
          dependsOn: [],
        }),
        expect.objectContaining({
          title: 'Documentation',
          message: 'docs: update Cradle Diffs coverage',
          paths: ['README.md'],
          dependsOn: ['commit:implementation'],
        }),
      ])

      const plan = commitPlan.commitPlans[0]!
      const updatedPlan = await putJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-lifecycle/diff-reviews/${review.id}/commit-plans/${plan.id}`,
        {
          status: 'accepted',
          rationale: 'Manual commit messages approved for local application.',
          groups: plan.groups.map(group => ({
            ...group,
            paths: ['client-provided-path-is-ignored.ts'],
            message: group.title === 'Implementation'
              ? 'diff-review: polish editable commit plans'
              : group.message,
          })),
        },
      )
      expect(updatedPlan.commitPlans[0]).toMatchObject({
        id: plan.id,
        strategy: 'manual',
        status: 'accepted',
        rationale: 'Manual commit messages approved for local application.',
      })
      expect(updatedPlan.commitPlans[0]?.groups[0]).toMatchObject({
        title: 'Implementation',
        message: 'diff-review: polish editable commit plans',
        paths: ['app.ts'],
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
          expect.objectContaining({ eventKind: 'commit_plan_updated' }),
        ]),
      )
    }
    finally {
      restoreTestInfra(previousEnv)
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('generates and persists a change walkthrough with a catalog-selected agent runtime', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-diff-review-workspace-')
    const previousEnv = useIsolatedTestInfra(dataDir)
    const runtime = new TestDiffReviewGuideRuntime()

    try {
      registerRuntime(runtime, undefined, 'diff-review-test')
      initGitRepository(workspaceRoot)
      commitFile(workspaceRoot, 'README.md', '# Diff Review Fixture', 'repo: initial commit')
      writeFileSync(join(workspaceRoot, 'README.md'), '# Diff Review Fixture\nneeds review guide\n', 'utf8')
      writeFileSync(join(workspaceRoot, 'src.ts'), 'export const value = 1\n', 'utf8')

      const app = await createServerApp()
      db()
        .insert(workspaces)
        .values(localWorkspaceRow({
          id: 'workspace-diff-review-guide',
          name: 'Workspace Diff Review Guide',
          path: workspaceRoot,
        }))
        .run()
      db().insert(providerTargets).values({
        id: 'provider-target-diff-review-guide',
        kind: 'manual',
        providerKind: 'openai-compatible',
        displayName: 'Diff Review Guide Provider',
        enabled: true,
      }).run()

      const review = await refreshLocalReview(app, 'workspace-diff-review-guide')
      const readme = review.files.find(item => item.path === 'README.md')
      const source = review.files.find(item => item.path === 'src.ts')
      expect(readme).toBeTruthy()
      expect(source).toBeTruthy()
      runtime.responseText = [
        'I inspected the working tree.',
        '<cradle_guide>',
        JSON.stringify({
          steps: [
            {
              title: 'Review README behavior',
              rationale: 'Start with the user-facing change before checking implementation.',
              paths: ['README.md'],
              ranges: [{ path: 'README.md', side: 'head', startLine: 2, endLine: 2 }],
              threadIds: ['unknown-thread-is-filtered'],
            },
            {
              title: 'Review implementation',
              rationale: 'Confirm the exported value matches the README expectation.',
              ranges: [{ path: 'src.ts', side: 'head', startLine: 1, endLine: 1 }],
            },
          ],
        }),
        '</cradle_guide>',
      ].join('\n')

      const generated = await postJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-guide/diff-reviews/${review.id}/guide/generate`,
        {
          providerTargetId: 'provider-target-diff-review-guide',
          modelId: 'gpt-5-codex',
          outputLocale: 'zh-CN',
        },
      )

      expect(generated.guide).toMatchObject({
        revisionId: review.currentRevisionId,
        status: 'running',
        providerTargetId: 'provider-target-diff-review-guide',
        runtimeKind: DIFF_REVIEW_GUIDE_TEST_RUNTIME_KIND,
        modelId: 'gpt-5-codex',
        errorMessage: null,
        steps: [],
      })
      expect(
        db()
          .select()
          .from(backgroundJobs)
          .where(eq(backgroundJobs.sourceRunId, generated.guide.runId!))
          .get(),
      ).toMatchObject({
        ownerNamespace: 'diff-review',
        ownerResourceId: review.id,
        ownerResourceKey: review.currentRevisionId,
        kind: 'guide-generation',
        status: 'running',
      })
      const guideSession = db().select().from(sessions).where(eq(sessions.id, generated.guide.sessionId!)).get()
      expect(guideSession?.origin).toBe('cradle-review')

      const completed = await waitForCondition(async () => {
        const reloaded = await getJson<DiffReviewResponse>(
          app,
          `/workspaces/workspace-diff-review-guide/diff-reviews/${review.id}`,
        )
        return reloaded.guide.status === 'ready' && reloaded.guide.steps.length === 2 ? reloaded : null
      }, 'change walkthrough generation')

      expect(runtime.streamInputs).toHaveLength(1)
      expect(runtime.streamInputs[0]).toMatchObject({
        workspacePath: workspaceRoot,
        profile: expect.objectContaining({
          providerTargetId: 'provider-target-diff-review-guide',
          providerKind: 'openai-compatible',
        }),
        providerOptions: {
          runtimeSettings: {
            accessMode: 'full-access',
            interactionMode: 'default',
          },
        },
      })
      const guidePrompt = JSON.stringify(runtime.streamInputs[0]?.message)
      expect(guidePrompt).toContain('git diff --stat HEAD')
      expect(guidePrompt).toContain('Simplified Chinese (zh-CN)')
      expect(guidePrompt).toContain('artifact \\"title\\", every step \\"title\\", and every step \\"rationale\\"')
      expect(guidePrompt).not.toContain('diff --git a/README.md b/README.md')
      expect(completed.guide).toMatchObject({
        revisionId: review.currentRevisionId,
        status: 'ready',
        providerTargetId: 'provider-target-diff-review-guide',
        runtimeKind: DIFF_REVIEW_GUIDE_TEST_RUNTIME_KIND,
        modelId: 'gpt-5-codex',
        errorMessage: null,
        steps: [
          {
            id: expect.stringMatching(/^step-1-/),
            title: 'Review README behavior',
            rationale: 'Start with the user-facing change before checking implementation.',
            fileIds: [readme!.id],
            threadIds: [],
            anchors: [expect.objectContaining({
              fileId: readme!.id,
              path: 'README.md',
              side: 'head',
              startLine: 2,
              endLine: 2,
            })],
            order: 0,
          },
          {
            id: expect.stringMatching(/^step-2-/),
            title: 'Review implementation',
            rationale: 'Confirm the exported value matches the README expectation.',
            fileIds: [source!.id],
            threadIds: [],
            anchors: [expect.objectContaining({
              fileId: source!.id,
              path: 'src.ts',
              side: 'head',
              startLine: 1,
              endLine: 1,
            })],
            order: 1,
          },
        ],
      })

      const reloaded = await getJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-guide/diff-reviews/${review.id}`,
      )
      expect(reloaded.guide).toEqual(completed.guide)
    }
    finally {
      unregisterRuntime(DIFF_REVIEW_GUIDE_TEST_RUNTIME_KIND, 'diff-review-test')
      restoreTestInfra(previousEnv)
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('lets change walkthrough generation outlive the global chat run wait timeout', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-diff-review-workspace-')
    const previousEnv = useIsolatedTestInfra(dataDir)
    const runtime = new TestDiffReviewGuideRuntime()

    try {
      process.env.CRADLE_CHAT_RUN_WAIT_TIMEOUT_MS = '1'
      registerRuntime(runtime, undefined, 'diff-review-test')
      initGitRepository(workspaceRoot)
      commitFile(workspaceRoot, 'README.md', '# Diff Review Fixture', 'repo: initial commit')
      writeFileSync(join(workspaceRoot, 'README.md'), '# Diff Review Fixture\nneeds delayed review guide\n', 'utf8')

      const app = await createServerApp()
      db()
        .insert(workspaces)
        .values(localWorkspaceRow({
          id: 'workspace-diff-review-guide-no-timeout',
          name: 'Workspace Diff Review Guide No Timeout',
          path: workspaceRoot,
        }))
        .run()
      db().insert(providerTargets).values({
        id: 'provider-target-diff-review-guide-no-timeout',
        kind: 'manual',
        providerKind: 'openai-compatible',
        displayName: 'Diff Review Guide No Timeout Provider',
        enabled: true,
      }).run()

      const review = await refreshLocalReview(app, 'workspace-diff-review-guide-no-timeout')
      const readme = review.files.find(item => item.path === 'README.md')
      expect(readme).toBeTruthy()
      runtime.blockNextRun = true
      runtime.responseText = [
        '<cradle_guide>',
        JSON.stringify({
          title: 'Delayed guide',
          steps: [
            {
              title: 'Review delayed README change',
              rationale: 'Large diffs may need more time than the shared waiter timeout.',
              ranges: [{ path: 'README.md', side: 'head', startLine: 2, endLine: 2 }],
            },
          ],
        }),
        '</cradle_guide>',
      ].join('\n')

      const generated = await postJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-guide-no-timeout/diff-reviews/${review.id}/guide/generate`,
        {
          providerTargetId: 'provider-target-diff-review-guide-no-timeout',
        },
      )
      expect(generated.guide.status).toBe('running')

      await waitForCondition(
        async () => runtime.streamInputs.length > 0 ? runtime.streamInputs.length : null,
        'delayed change walkthrough run to start',
      )
      await new Promise(resolve => setTimeout(resolve, 30))
      const stillRunning = await getJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-guide-no-timeout/diff-reviews/${review.id}`,
      )
      expect(stillRunning.guide).toMatchObject({
        status: 'running',
        errorMessage: null,
      })

      runtime.releaseRun()
      const completed = await waitForCondition(async () => {
        const reloaded = await getJson<DiffReviewResponse>(
          app,
          `/workspaces/workspace-diff-review-guide-no-timeout/diff-reviews/${review.id}`,
        )
        return reloaded.guide.status === 'ready' ? reloaded : null
      }, 'delayed change walkthrough generation')

      expect(completed.guide).toMatchObject({
        status: 'ready',
        errorMessage: null,
        steps: [
          expect.objectContaining({
            title: 'Review delayed README change',
            fileIds: [readme!.id],
          }),
        ],
      })
    }
    finally {
      runtime.releaseRun()
      unregisterRuntime(DIFF_REVIEW_GUIDE_TEST_RUNTIME_KIND, 'diff-review-test')
      restoreTestInfra(previousEnv)
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('keeps change walkthrough generation alive when the local worktree changes during the run', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-diff-review-workspace-')
    const previousEnv = useIsolatedTestInfra(dataDir)
    const runtime = new TestDiffReviewGuideRuntime()

    try {
      registerRuntime(runtime, undefined, 'diff-review-test')
      initGitRepository(workspaceRoot)
      commitFile(workspaceRoot, 'README.md', '# Diff Review Fixture', 'repo: initial commit')
      writeFileSync(join(workspaceRoot, 'README.md'), '# Diff Review Fixture\nneeds review guide\n', 'utf8')

      const app = await createServerApp()
      db()
        .insert(workspaces)
        .values(localWorkspaceRow({
          id: 'workspace-diff-review-guide-source-changed',
          name: 'Workspace Diff Review Guide Source Changed',
          path: workspaceRoot,
        }))
        .run()
      db().insert(providerTargets).values({
        id: 'provider-target-diff-review-guide-source-changed',
        kind: 'manual',
        providerKind: 'openai-compatible',
        displayName: 'Diff Review Guide Source Changed Provider',
        enabled: true,
      }).run()

      const review = await refreshLocalReview(app, 'workspace-diff-review-guide-source-changed')
      const readme = review.files.find(item => item.path === 'README.md')
      expect(readme).toBeTruthy()
      runtime.blockNextRun = true
      runtime.responseText = [
        'I inspected the working tree.',
        '<cradle_guide>',
        JSON.stringify({
          steps: [
            {
              title: 'Review stored README change',
              rationale: 'Use the stored review revision even if the live worktree changes later.',
              ranges: [{ path: 'README.md', side: 'head', startLine: 2, endLine: 2 }],
            },
          ],
        }),
        '</cradle_guide>',
      ].join('\n')

      const generated = await postJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-guide-source-changed/diff-reviews/${review.id}/guide/generate`,
        {
          providerTargetId: 'provider-target-diff-review-guide-source-changed',
          runtimeKind: DIFF_REVIEW_GUIDE_TEST_RUNTIME_KIND,
        },
      )

      expect(generated.guide).toMatchObject({
        revisionId: review.currentRevisionId,
        status: 'running',
      })

      writeFileSync(join(workspaceRoot, 'README.md'), '# Diff Review Fixture\nchanged while running\n', 'utf8')
      writeFileSync(join(workspaceRoot, 'later.ts'), 'export const later = true\n', 'utf8')
      runtime.releaseRun()

      const completed = await waitForCondition(async () => {
        const reloaded = await getJson<DiffReviewResponse>(
          app,
          `/workspaces/workspace-diff-review-guide-source-changed/diff-reviews/${review.id}`,
        )
        return reloaded.guide.status === 'ready' ? reloaded : null
      }, 'change walkthrough generation after source change')

      expect(completed.currentRevisionId).toBe(review.currentRevisionId)
      expect(completed.guide).toMatchObject({
        revisionId: review.currentRevisionId,
        status: 'ready',
        errorMessage: null,
        steps: [
          {
            title: 'Review stored README change',
            fileIds: [readme!.id],
            anchors: [expect.objectContaining({
              fileId: readme!.id,
              path: 'README.md',
              startLine: 2,
              endLine: 2,
            })],
          },
        ],
      })
    }
    finally {
      runtime.releaseRun()
      unregisterRuntime(DIFF_REVIEW_GUIDE_TEST_RUNTIME_KIND, 'diff-review-test')
      restoreTestInfra(previousEnv)
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('projects stored change walkthrough steps without anchors into the current response contract', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-diff-review-workspace-')
    const previousEnv = useIsolatedTestInfra(dataDir)

    try {
      initGitRepository(workspaceRoot)
      commitFile(workspaceRoot, 'README.md', '# Diff Review Fixture', 'repo: initial commit')
      writeFileSync(join(workspaceRoot, 'README.md'), '# Diff Review Fixture\nlegacy guide\n', 'utf8')

      const app = await createServerApp()
      db()
        .insert(workspaces)
        .values(localWorkspaceRow({
          id: 'workspace-diff-review-guide-legacy',
          name: 'Workspace Diff Review Guide Legacy',
          path: workspaceRoot,
        }))
        .run()

      const review = await refreshLocalReview(app, 'workspace-diff-review-guide-legacy')
      const readme = review.files.find(item => item.path === 'README.md')
      expect(readme).toBeTruthy()

      db().insert(diffReviewGuides).values({
        id: 'legacy-guide-without-anchors',
        reviewId: review.id,
        revisionId: review.currentRevisionId!,
        providerTargetId: null,
        runtimeKind: 'codex',
        modelId: null,
        inputHash: 'legacy-input-hash',
        status: 'ready',
        stepsJson: JSON.stringify([
          {
            id: 'legacy-step',
            title: 'Review README',
            rationale: 'Legacy rows predate range anchors.',
            fileIds: [readme!.id],
            threadIds: [],
            order: 0,
          },
        ]),
        errorMessage: null,
        createdAt: 1,
        updatedAt: 1,
      }).run()

      const reviews = await getJson<DiffReviewResponse[]>(
        app,
        '/workspaces/workspace-diff-review-guide-legacy/diff-reviews',
      )
      expect(reviews[0]?.guide.steps[0]).toMatchObject({
        id: 'legacy-step',
        title: 'Review README',
        fileIds: [readme!.id],
        anchors: [],
      })
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

  it('creates a manual commit plan from completed commit planning output', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-diff-review-workspace-')
    const previousEnv = useIsolatedTestInfra(dataDir)
    const runtime = new TestDiffReviewRuntime()
    const originalStandardRuntime = getRuntimeRegistry().get('standard')

    try {
      registerRuntime(runtime)
      initGitRepository(workspaceRoot)
      commitFile(workspaceRoot, 'README.md', '# Diff Review Fixture', 'repo: initial commit')
      writeFileSync(join(workspaceRoot, 'README.md'), '# Diff Review Fixture\ncommit docs\n', 'utf8')
      writeFileSync(join(workspaceRoot, 'app.ts'), 'export const planned = true\n', 'utf8')

      const app = await createServerApp()
      db()
        .insert(workspaces)
        .values(localWorkspaceRow({
          id: 'workspace-diff-review-commit-plan-agent',
          name: 'Workspace Diff Review Commit Plan Agent',
          path: workspaceRoot,
        }))
        .run()
      db().insert(providerTargets).values({
        id: 'provider-target-diff-review-commit-plan-agent',
        kind: 'manual',
        providerKind: 'openai-compatible',
        displayName: 'Diff Review Commit Plan Provider',
        enabled: true,
      }).run()

      const review = await refreshLocalReview(app, 'workspace-diff-review-commit-plan-agent')
      const appFile = review.files.find(file => file.path === 'app.ts')
      const readmeFile = review.files.find(file => file.path === 'README.md')
      expect(appFile).toBeTruthy()
      expect(readmeFile).toBeTruthy()
      runtime.responseText = [
        '<cradle_commit_plan>',
        JSON.stringify({
          rationale: 'Keep implementation and documentation reviewable as separate commits.',
          groups: [
            {
              title: 'Implementation',
              message: 'diff-review: add planned implementation',
              rationale: 'Adds the runtime-facing code change.',
              fileIds: [appFile!.id],
            },
            {
              title: 'Documentation',
              message: 'docs: describe planned commit flow',
              rationale: 'Documents the changed behavior after the code lands.',
              fileIds: [readmeFile!.id],
              dependsOn: [1],
            },
          ],
        }),
        '</cradle_commit_plan>',
      ].join('\n')

      const created = await postJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-commit-plan-agent/diff-reviews/${review.id}/agent-fixes`,
        {
          instruction: 'Plan a clean commit sequence for this review.',
          expectedOutput: 'commit',
        },
      )
      const agentFix = created.agentFixes[0]!
      const started = await postJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-commit-plan-agent/diff-reviews/${review.id}/agent-fixes/${agentFix.id}/start`,
        {
          providerTargetId: 'provider-target-diff-review-commit-plan-agent',
          runtimeKind: 'standard',
          outputLocale: 'zh-CN',
        },
      )
      expect(started.agentFixes.find(item => item.id === agentFix.id)).toMatchObject({
        status: 'running',
      })
      const startedFix = started.agentFixes.find(item => item.id === agentFix.id)!
      expect(
        db()
          .select()
          .from(backgroundJobs)
          .where(eq(backgroundJobs.sourceRunId, startedFix.runId!))
          .get(),
      ).toMatchObject({
        ownerNamespace: 'diff-review',
        ownerResourceId: review.id,
        ownerResourceKey: agentFix.id,
        kind: 'commit-plan-generation',
        status: 'running',
      })
      expect(runtime.streamInputs[0]?.message.parts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: expect.stringContaining('<cradle_commit_plan>'),
          }),
        ]),
      )
      const commitPlanPrompt = JSON.stringify(runtime.streamInputs[0]?.message)
      expect(commitPlanPrompt).toContain('Simplified Chinese (zh-CN)')
      expect(commitPlanPrompt).toContain('artifact \\"rationale\\", every group \\"title\\", and every group \\"rationale\\"')
      expect(commitPlanPrompt).toContain('Do not translate or localize commit messages solely because of the output language.')

      const completed = await waitForCondition(async () => {
        const reloaded = await getJson<DiffReviewResponse>(
          app,
          `/workspaces/workspace-diff-review-commit-plan-agent/diff-reviews/${review.id}`,
        )
        const completedFix = reloaded.agentFixes.find(item => item.id === agentFix.id)
        return completedFix?.status === 'completed' && reloaded.commitPlans.length === 1 ? reloaded : null
      }, 'diff review commit plan generation')
      const plan = completed.commitPlans[0]!
      expect(plan).toMatchObject({
        strategy: 'manual',
        status: 'draft',
        rationale: 'Keep implementation and documentation reviewable as separate commits.',
      })
      expect(plan.groups).toEqual([
        expect.objectContaining({
          title: 'Implementation',
          message: 'diff-review: add planned implementation',
          fileIds: [appFile!.id],
          paths: ['app.ts'],
          dependsOn: [],
        }),
        expect.objectContaining({
          title: 'Documentation',
          message: 'docs: describe planned commit flow',
          fileIds: [readmeFile!.id],
          paths: ['README.md'],
          dependsOn: [plan.groups[0]!.id],
        }),
      ])
      expect(completed.agentFixes.find(item => item.id === agentFix.id)).toMatchObject({
        status: 'completed',
        resultRevisionId: completed.currentRevisionId,
        errorMessage: null,
      })
      expect(completed.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventKind: 'commit_plan_created',
            payload: expect.objectContaining({ commitPlanId: plan.id, agentFixId: agentFix.id }),
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

  it('lets commit plan generation outlive the global chat run wait timeout', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-diff-review-workspace-')
    const previousEnv = useIsolatedTestInfra(dataDir)
    const runtime = new TestDiffReviewRuntime()
    const originalStandardRuntime = getRuntimeRegistry().get('standard')

    try {
      process.env.CRADLE_CHAT_RUN_WAIT_TIMEOUT_MS = '1'
      registerRuntime(runtime)
      initGitRepository(workspaceRoot)
      commitFile(workspaceRoot, 'README.md', '# Diff Review Fixture', 'repo: initial commit')
      writeFileSync(join(workspaceRoot, 'README.md'), '# Diff Review Fixture\ndelayed commit plan\n', 'utf8')

      const app = await createServerApp()
      db()
        .insert(workspaces)
        .values(localWorkspaceRow({
          id: 'workspace-diff-review-commit-plan-no-timeout',
          name: 'Workspace Diff Review Commit Plan No Timeout',
          path: workspaceRoot,
        }))
        .run()
      db().insert(providerTargets).values({
        id: 'provider-target-diff-review-commit-plan-no-timeout',
        kind: 'manual',
        providerKind: 'openai-compatible',
        displayName: 'Diff Review Commit Plan No Timeout Provider',
        enabled: true,
      }).run()

      const review = await refreshLocalReview(app, 'workspace-diff-review-commit-plan-no-timeout')
      const readme = review.files.find(file => file.path === 'README.md')
      expect(readme).toBeTruthy()
      runtime.blockNextRun = true
      runtime.responseText = [
        '<cradle_commit_plan>',
        JSON.stringify({
          rationale: 'Keep the delayed documentation change as one commit.',
          groups: [
            {
              title: 'Documentation',
              message: 'docs: describe delayed commit planning',
              rationale: 'Covers the user-facing documentation change.',
              fileIds: [readme!.id],
            },
          ],
        }),
        '</cradle_commit_plan>',
      ].join('\n')

      const created = await postJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-commit-plan-no-timeout/diff-reviews/${review.id}/agent-fixes`,
        {
          instruction: 'Plan commits even if generation takes longer than the shared waiter timeout.',
          expectedOutput: 'commit',
        },
      )
      const agentFix = created.agentFixes[0]!
      const started = await postJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-commit-plan-no-timeout/diff-reviews/${review.id}/agent-fixes/${agentFix.id}/start`,
        {
          providerTargetId: 'provider-target-diff-review-commit-plan-no-timeout',
          runtimeKind: 'standard',
        },
      )
      expect(started.agentFixes.find(item => item.id === agentFix.id)).toMatchObject({
        status: 'running',
      })

      await waitForCondition(
        async () => runtime.streamInputs.length > 0 ? runtime.streamInputs.length : null,
        'delayed commit plan run to start',
      )
      await new Promise(resolve => setTimeout(resolve, 30))
      const stillRunning = await getJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-commit-plan-no-timeout/diff-reviews/${review.id}`,
      )
      expect(stillRunning.agentFixes.find(item => item.id === agentFix.id)).toMatchObject({
        status: 'running',
      })
      expect(stillRunning.commitPlans).toHaveLength(0)

      runtime.releaseRun()
      const completed = await waitForCondition(async () => {
        const reloaded = await getJson<DiffReviewResponse>(
          app,
          `/workspaces/workspace-diff-review-commit-plan-no-timeout/diff-reviews/${review.id}`,
        )
        const completedFix = reloaded.agentFixes.find(item => item.id === agentFix.id)
        return completedFix?.status === 'completed' && reloaded.commitPlans.length === 1 ? reloaded : null
      }, 'delayed diff review commit plan generation')

      expect(completed.agentFixes.find(item => item.id === agentFix.id)).toMatchObject({
        status: 'completed',
        errorMessage: null,
      })
      expect(completed.commitPlans[0]).toMatchObject({
        strategy: 'manual',
        status: 'draft',
        groups: [
          expect.objectContaining({
            title: 'Documentation',
            fileIds: [readme!.id],
            paths: ['README.md'],
          }),
        ],
      })
    }
    finally {
      runtime.releaseRun()
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

  it('applies an accepted local commit plan as native git commits', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-diff-review-workspace-')
    const previousEnv = useIsolatedTestInfra(dataDir)

    try {
      initGitRepository(workspaceRoot)
      commitFile(workspaceRoot, 'README.md', '# Diff Review Fixture', 'repo: initial commit')
      writeFileSync(join(workspaceRoot, 'README.md'), '# Diff Review Fixture\ncommit docs\n', 'utf8')
      writeFileSync(join(workspaceRoot, 'app.ts'), 'export const applied = true\n', 'utf8')

      const app = await createServerApp()
      db()
        .insert(workspaces)
        .values(localWorkspaceRow({
          id: 'workspace-diff-review-apply',
          name: 'Workspace Diff Review Apply',
          path: workspaceRoot,
        }))
        .run()

      const review = await refreshLocalReview(app, 'workspace-diff-review-apply')
      const planId = insertManualCommitPlan(review, {
        groups: [
          {
            id: 'commit:implementation',
            title: 'Implementation',
            message: 'diff-review: apply implementation group',
            rationale: 'Commit implementation files first.',
            paths: ['app.ts'],
            dependsOn: [],
          },
          {
            id: 'commit:documentation',
            title: 'Documentation',
            message: 'docs: apply documentation group',
            rationale: 'Commit documentation after implementation.',
            paths: ['README.md'],
            dependsOn: ['commit:implementation'],
          },
        ],
      })
      const commitPlan = await getJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-apply/diff-reviews/${review.id}`,
      )
      const plan = commitPlan.commitPlans.find(item => item.id === planId)!
      const accepted = await putJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-apply/diff-reviews/${review.id}/commit-plans/${plan.id}`,
        {
          status: 'accepted',
          groups: plan.groups.map(group => ({
            ...group,
            message: group.title === 'Implementation'
              ? 'diff-review: apply implementation group'
              : 'docs: apply documentation group',
          })),
        },
      )
      expect(accepted.commitPlans[0]?.status).toBe('accepted')

      const applied = await postJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-apply/diff-reviews/${review.id}/commit-plans/${plan.id}/apply`,
        { idempotencyKey: 'apply-once' },
      )
      expect(applied.currentRevisionId).toBeNull()
      expect(applied.currentRevision).toBeNull()
      expect(applied.files).toEqual([])
      expect(applied.commitPlans[0]).toMatchObject({
        id: plan.id,
        status: 'applied',
      })
      expect(runGit(workspaceRoot, ['status', '--porcelain'])).toBe('')
      expect(runGit(workspaceRoot, ['log', '--pretty=%s', '-n', '3']).split('\n')).toEqual([
        'docs: apply documentation group',
        'diff-review: apply implementation group',
        'repo: initial commit',
      ])

      const commitCount = runGit(workspaceRoot, ['rev-list', '--count', 'HEAD'])
      const retried = await postJson<DiffReviewResponse>(
        app,
        `/workspaces/workspace-diff-review-apply/diff-reviews/${review.id}/commit-plans/${plan.id}/apply`,
        { idempotencyKey: 'apply-once' },
      )
      expect(retried.commitPlans[0]?.status).toBe('applied')
      expect(runGit(workspaceRoot, ['rev-list', '--count', 'HEAD'])).toBe(commitCount)
      expect(retried.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ eventKind: 'commit_plan_applied' }),
        ]),
      )
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
