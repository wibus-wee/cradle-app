import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sessions, works, workspaces, workThreads, worktrees } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { localWorkspaceLocatorJson } from '../../../tests/helpers/workspace-fixture'
import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import * as PullRequest from '../pull-request/service'
import * as Session from '../session/service'
import * as Worktree from '../worktree/service'
import * as Work from './service'

const WORKSPACE_ID = 'work-service-workspace'
const SESSION_ID = 'work-service-session'
const WORK_ID = 'work-service-work'

const OPEN_PULL_REQUEST: PullRequest.SessionPullRequestView = {
  owner: 'acme',
  repo: 'cradle',
  number: 42,
  url: 'https://github.com/acme/cradle/pull/42',
  title: 'Draft title',
  isDraft: true,
  state: 'open',
  merged: false,
  headRef: 'cradle/wt/work',
  baseRef: 'main',
  headSha: 'head-sha',
  createdAt: 10,
  updatedAt: 10,
}

function seedWork(): void {
  db().insert(workspaces).values({
    id: WORKSPACE_ID,
    name: 'Work Service Workspace',
    locatorJson: localWorkspaceLocatorJson('/tmp/work-service'),
    identifier: 'WSW',
  }).run()
  db().insert(sessions).values({
    id: SESSION_ID,
    workspaceId: WORKSPACE_ID,
    title: 'Primary Work Session',
  }).run()
  db().insert(works).values({
    id: WORK_ID,
    title: 'Implement Work',
    objective: 'Implement the local Work flow.',
  }).run()
  db().insert(workThreads).values({
    workId: WORK_ID,
    sessionId: SESSION_ID,
    role: 'primary',
  }).run()
}

function mockHealthyDetailReads() {
  const readiness = vi.spyOn(PullRequest, 'inspectPullRequestReadiness').mockResolvedValue({
    isolated: true,
    clean: true,
    branch: 'cradle/wt/work',
    baseRef: 'base-sha',
    commitsAhead: 1,
    changedFiles: 0,
  })
  const pullRequest = vi.spyOn(PullRequest, 'getPullRequest').mockResolvedValue(null)
  const isolation = vi.spyOn(Worktree, 'readSessionIsolationAsync').mockResolvedValue({
    isIsolated: true,
    worktreeId: 'worktree-1',
    worktreeBranch: 'cradle/wt/work',
    worktreePath: '/tmp/worktree-1',
    worktreeHealth: 'ok',
    pendingWorktreeId: null,
    isolationBoundaryRequired: false,
  })
  return { readiness, pullRequest, isolation }
}

afterEach(() => {
  vi.restoreAllMocks()
  db().delete(workThreads).run()
  db().delete(works).run()
  db().delete(sessions).run()
  db().delete(worktrees).run()
  db().delete(workspaces).run()
})

describe('deriveActivity', () => {
  it('uses blocked, waiting, running, idle precedence', () => {
    expect(Work.deriveActivity({
      sessionStatus: 'streaming',
      worktreeHealth: 'missing',
      awaiting: true,
      waitingForInteraction: true,
    })).toBe('blocked')
    expect(Work.deriveActivity({
      sessionStatus: 'streaming',
      worktreeHealth: 'ok',
      awaiting: true,
      waitingForInteraction: false,
    })).toBe('waiting')
    expect(Work.deriveActivity({
      sessionStatus: 'streaming',
      worktreeHealth: 'ok',
      awaiting: false,
      waitingForInteraction: false,
    })).toBe('running')
    expect(Work.deriveActivity({
      sessionStatus: 'idle',
      worktreeHealth: 'ok',
      awaiting: false,
      waitingForInteraction: false,
    })).toBe('idle')
  })
})

describe('work delivery control', () => {
  it('projects the primary Session title instead of the stale creation title', async () => {
    seedWork()
    mockHealthyDetailReads()

    const [summary] = Work.list({ workspaceId: WORKSPACE_ID })
    const detail = await Work.get(WORK_ID)

    expect(summary?.title).toBe('Primary Work Session')
    expect(detail?.work.title).toBe('Primary Work Session')
    expect(db().select({ title: works.title }).from(works).where(eq(works.id, WORK_ID)).get()?.title)
      .toBe('Implement Work')
  })

  it('creates a primary Session in a healthy managed Worktree from a clean repository', async () => {
    const repositoryPath = mkdtempSync(join(tmpdir(), 'cradle-work-service-'))
    try {
      execFileSync('git', ['init'], { cwd: repositoryPath })
      execFileSync('git', ['config', 'user.email', 'work-test@example.com'], { cwd: repositoryPath })
      execFileSync('git', ['config', 'user.name', 'Work Test'], { cwd: repositoryPath })
      writeFileSync(join(repositoryPath, 'README.md'), '# Work test\n', 'utf8')
      execFileSync('git', ['add', 'README.md'], { cwd: repositoryPath })
      execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: repositoryPath })
      db().insert(workspaces).values({
        id: WORKSPACE_ID,
        name: 'Work Service Workspace',
        locatorJson: localWorkspaceLocatorJson(repositoryPath),
        identifier: 'WSW',
      }).run()

      const detail = await Work.create({
        workspaceId: WORKSPACE_ID,
        title: 'Create managed Work',
        objective: 'Create an isolated local Work container.',
        runtimeKind: 'opencode',
      })

      expect(detail.primaryThread.origin).toBe('work')
      expect(detail.execution.isIsolated).toBe(true)
      expect(detail.execution.worktreeHealth).toBe('ok')
      expect(detail.readiness.commitsAhead).toBe(0)
      expect(db().select().from(works).all()).toHaveLength(1)
      expect(db().select().from(workThreads).all()).toHaveLength(1)

      const worktreePath = detail.execution.worktreePath!
      writeFileSync(join(worktreePath, 'work.txt'), 'prepared\n', 'utf8')
      execFileSync('git', ['add', 'work.txt'], { cwd: worktreePath })
      execFileSync('git', ['commit', '-m', 'Prepare work'], { cwd: worktreePath })
      const prepared = await Work.prepare({
        id: detail.work.id,
        title: 'Create managed Work',
        summary: 'Created the managed Work flow.',
        testPlan: 'Run the Work service tests.',
      })
      expect(prepared.readiness.commitsAhead).toBe(1)
      expect(prepared.work.handoffSummary).toBe('Created the managed Work flow.')

      await Worktree.cleanupWorktree({
        worktreeId: detail.execution.worktreeId!,
        mode: 'abandon',
      })
    }
    finally {
      rmSync(repositoryPath, { recursive: true, force: true })
    }
  })

  it('prepares handoff metadata without creating or updating a pull request', async () => {
    seedWork()
    mockHealthyDetailReads()
    const createPullRequest = vi.spyOn(PullRequest, 'createDraftPullRequest')
    const updatePullRequest = vi.spyOn(PullRequest, 'updatePullRequest')

    const detail = await Work.prepare({
      id: WORK_ID,
      title: 'Draft title',
      summary: 'Implemented the flow.',
      testPlan: 'Run focused tests.',
    })

    expect(detail.work.handoffTitle).toBe('Draft title')
    expect(detail.work.preparedAt).not.toBeNull()
    expect(detail.work.lastSubmittedAt).toBeNull()
    expect(createPullRequest).not.toHaveBeenCalled()
    expect(updatePullRequest).not.toHaveBeenCalled()
  })

  it('keeps delivery timestamps ordered across same-second prepare and submit actions', async () => {
    seedWork()
    const { pullRequest } = mockHealthyDetailReads()
    db().update(works).set({
      handoffTitle: 'Earlier title',
      handoffSummary: 'Earlier summary.',
      handoffTestPlan: 'Earlier tests.',
      preparedAt: 4_000_000_000,
      lastSubmittedAt: 4_000_000_000,
    }).run()

    const prepared = await Work.prepare({
      id: WORK_ID,
      title: 'Follow-up title',
      summary: 'Follow-up summary.',
      testPlan: 'Follow-up tests.',
    })
    expect(prepared.work.preparedAt).toBeGreaterThan(prepared.work.lastSubmittedAt!)

    pullRequest.mockResolvedValue(OPEN_PULL_REQUEST)
    vi.spyOn(PullRequest, 'updatePullRequest').mockResolvedValue(OPEN_PULL_REQUEST)
    const submitted = await Work.submit({ id: WORK_ID })
    expect(submitted.work.lastSubmittedAt).toBeGreaterThan(submitted.work.preparedAt!)
  })

  it('rejects whitespace-only prepared handoff fields', async () => {
    seedWork()
    mockHealthyDetailReads()

    await expect(Work.prepare({
      id: WORK_ID,
      title: '   ',
      summary: 'Implemented the flow.',
      testPlan: 'Run focused tests.',
    })).rejects.toMatchObject({ code: 'work_handoff_required' })
  })

  it('rejects submit when no complete handoff is available', async () => {
    seedWork()
    mockHealthyDetailReads()

    await expect(Work.submit({ id: WORK_ID })).rejects.toMatchObject({
      code: 'work_handoff_required',
    })
  })

  it.each([
    {
      name: 'dirty',
      readiness: { clean: false, commitsAhead: 1, changedFiles: 2 },
      code: 'work_checkout_dirty',
    },
    {
      name: 'empty',
      readiness: { clean: true, commitsAhead: 0, changedFiles: 0 },
      code: 'work_no_commits',
    },
  ])('rejects $name Work before delivery', async ({ readiness, code }) => {
    seedWork()
    const mocks = mockHealthyDetailReads()
    mocks.readiness.mockResolvedValue({
      isolated: true,
      branch: 'cradle/wt/work',
      baseRef: 'base-sha',
      ...readiness,
    })

    await expect(Work.submit({
      id: WORK_ID,
      title: 'Draft title',
      summary: 'Implemented the flow.',
      testPlan: 'Run focused tests.',
    })).rejects.toMatchObject({ code })
  })

  it('creates a draft pull request only when submit is explicitly called', async () => {
    seedWork()
    mockHealthyDetailReads()
    db().update(works).set({
      handoffTitle: 'Draft title',
      handoffSummary: 'Implemented the flow.',
      handoffTestPlan: 'Run focused tests.',
      preparedAt: 10,
    }).run()
    const createPullRequest = vi.spyOn(PullRequest, 'createDraftPullRequest').mockResolvedValue(OPEN_PULL_REQUEST)

    const detail = await Work.submit({ id: WORK_ID })

    expect(createPullRequest).toHaveBeenCalledTimes(1)
    expect(createPullRequest).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: SESSION_ID,
      title: 'Draft title',
      body: '## Summary\nImplemented the flow.\n\n## Test plan\nRun focused tests.',
    }))
    expect(detail.work.lastSubmittedAt).not.toBeNull()
  })

  it('updates the same open draft pull request on repeated explicit submit', async () => {
    seedWork()
    const { pullRequest } = mockHealthyDetailReads()
    pullRequest.mockResolvedValue(OPEN_PULL_REQUEST)
    db().update(works).set({
      handoffTitle: 'Updated title',
      handoffSummary: 'Updated summary.',
      handoffTestPlan: 'Run updated tests.',
      preparedAt: 20,
      lastSubmittedAt: 10,
    }).run()
    const createPullRequest = vi.spyOn(PullRequest, 'createDraftPullRequest')
    const updatePullRequest = vi.spyOn(PullRequest, 'updatePullRequest').mockResolvedValue({
      ...OPEN_PULL_REQUEST,
      title: 'Updated title',
      updatedAt: 20,
    })

    await Work.submit({ id: WORK_ID })

    expect(createPullRequest).not.toHaveBeenCalled()
    expect(updatePullRequest).toHaveBeenCalledTimes(1)
    expect(updatePullRequest).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      title: 'Updated title',
      body: '## Summary\nUpdated summary.\n\n## Test plan\nRun updated tests.',
    })
  })

  it('rejects a closed pull request instead of creating another one', async () => {
    seedWork()
    const { pullRequest } = mockHealthyDetailReads()
    pullRequest.mockResolvedValue({
      ...OPEN_PULL_REQUEST,
      state: 'closed',
    })

    await expect(Work.submit({
      id: WORK_ID,
      title: 'Draft title',
      summary: 'Implemented the flow.',
      testPlan: 'Run focused tests.',
    })).rejects.toMatchObject({ code: 'work_pull_request_closed' })
  })

  it('retains the prepared handoff when explicit submission fails', async () => {
    seedWork()
    mockHealthyDetailReads()
    db().update(works).set({
      handoffTitle: 'Draft title',
      handoffSummary: 'Implemented the flow.',
      handoffTestPlan: 'Run focused tests.',
      preparedAt: 20,
    }).run()
    vi.spyOn(PullRequest, 'createDraftPullRequest').mockRejectedValue(new AppError({
      code: 'github_auth_required',
      status: 401,
      message: 'GitHub authentication required',
    }))

    await expect(Work.submit({ id: WORK_ID })).rejects.toMatchObject({
      code: 'github_auth_required',
    })
    expect(db().select().from(works).where(eq(works.id, WORK_ID)).get()).toMatchObject({
      handoffTitle: 'Draft title',
      handoffSummary: 'Implemented the flow.',
      handoffTestPlan: 'Run focused tests.',
      preparedAt: 20,
      lastSubmittedAt: null,
    })
  })

  it('rejects creation before Session persistence when the source checkout is dirty', async () => {
    vi.spyOn(Worktree, 'assertWorkspaceCleanForManagedIsolation').mockRejectedValue(new AppError({
      code: 'work_source_dirty',
      status: 409,
      message: 'dirty',
    }))
    const createSession = vi.spyOn(Session, 'create')

    await expect(Work.create({
      workspaceId: WORKSPACE_ID,
      title: 'Dirty Work',
      objective: 'Should not persist.',
    })).rejects.toMatchObject({ code: 'work_source_dirty' })

    expect(createSession).not.toHaveBeenCalled()
    expect(db().select().from(works).all()).toHaveLength(0)
    expect(db().select().from(sessions).all()).toHaveLength(0)
  })

  it('removes the primary Session when managed Worktree creation fails', async () => {
    db().insert(workspaces).values({
      id: WORKSPACE_ID,
      name: 'Work Service Workspace',
      locatorJson: localWorkspaceLocatorJson('/tmp/work-service'),
      identifier: 'WSW',
    }).run()
    vi.spyOn(Worktree, 'assertWorkspaceCleanForManagedIsolation').mockResolvedValue()
    vi.spyOn(Worktree, 'createWorktree').mockRejectedValue(new AppError({
      code: 'worktree_create_failed',
      status: 500,
      message: 'failed',
    }))

    await expect(Work.create({
      workspaceId: WORKSPACE_ID,
      title: 'Compensated Work',
      objective: 'Leave no orphan Session.',
      runtimeKind: 'opencode',
    })).rejects.toMatchObject({ code: 'worktree_create_failed' })

    expect(db().select().from(works).all()).toHaveLength(0)
    expect(db().select().from(sessions).all()).toHaveLength(0)
  })
})
