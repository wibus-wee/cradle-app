import { Elysia, t } from 'elysia'

import { WorktreeModel } from './model'
import * as Worktree from './service'

export const worktree = new Elysia({
  detail: { tags: ['worktree'] },
})
  .get('/worktrees/managed', () => Worktree.listManagedWorktrees(), {
    detail: {
      summary: 'List Cradle-managed worktrees',
      description: 'Settings-facing aggregate of active Cradle-managed worktrees across all workspaces.',
    },
    response: { 200: WorktreeModel.managedWorktreeListResponse },
  })
  .post('/worktrees/cleanup', ({ body }) => Worktree.cleanupManagedWorktrees(body), {
    detail: {
      summary: 'Cleanup Cradle-managed worktrees',
      description: 'Apply the configured managed worktree retention policy by abandoning oldest unbound worktrees first.',
    },
    body: WorktreeModel.managedWorktreeCleanupBody,
    response: { 200: WorktreeModel.managedWorktreeCleanupResponse },
  })
  .group('/workspaces', app => app
    .get('/:workspaceId/worktrees', ({ params }) => Worktree.listWorktreesByWorkspace(params.workspaceId), {
      detail: {
        'summary': 'List active worktrees for workspace',
        'x-cradle-cli': {
          command: ['workspace', 'worktree', 'list'],
          defaultWorkspaceId: true,
        },
      },
      params: WorktreeModel.workspaceIdParams,
      response: { 200: t.Array(WorktreeModel.worktreeView) },
    })
    .post('/:workspaceId/worktrees', async ({ params, body }) => {
      const worktreeRecord = await Worktree.createWorktree({
        sourceWorkspaceId: params.workspaceId,
        sessionId: body.sessionId,
        slug: body.slug ?? 'isolated',
        confirmedSetupHooks: body.confirmedSetupHooks === true,
      })
      if (body.bindSession !== false) {
        Worktree.attachSessionToWorktree({
          sessionId: body.sessionId,
          worktreeId: worktreeRecord.id,
        })
      }
      return worktreeRecord
    }, {
      detail: {
        'summary': 'Create managed worktree',
        'x-cradle-cli': {
          command: ['workspace', 'worktree', 'create'],
          defaultWorkspaceId: true,
        },
      },
      params: WorktreeModel.workspaceIdParams,
      body: t.Object({
        sessionId: t.String({ minLength: 1 }),
        slug: t.Optional(t.String({ minLength: 1 })),
        bindSession: t.Optional(t.Boolean()),
        confirmedSetupHooks: t.Optional(t.Boolean()),
      }),
      response: { 200: WorktreeModel.worktreeView },
    })
    .post('/:workspaceId/worktrees/:worktreeId/cleanup', async ({ params, body }) => {
      await Worktree.cleanupWorktree({
        worktreeId: params.worktreeId,
        mode: body.mode,
        targetBranch: body.targetBranch,
      })
      return { ok: true as const }
    }, {
      detail: {
        'summary': 'Cleanup managed worktree',
        'x-cradle-cli': {
          command: ['workspace', 'worktree', 'cleanup'],
          defaultWorkspaceId: true,
        },
      },
      params: t.Object({
        workspaceId: t.String({ minLength: 1 }),
        worktreeId: t.String({ minLength: 1 }),
      }),
      body: WorktreeModel.cleanupBody,
      response: { 200: t.Object({ ok: t.Literal(true) }) },
    }))
