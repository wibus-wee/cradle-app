import { Elysia, t } from 'elysia'

import { GitModel } from './model'
import * as Git from './service'

export const git = new Elysia({
  prefix: '/workspaces',
  detail: { tags: ['git'] },
})
  .get('/:workspaceId/git/repositories', ({ params }) => Git.getRepositories(params.workspaceId), {
    detail: {
      'summary': 'Get git repositories',
      'x-cradle-cli': {
        command: ['workspace', 'git', 'repositories'],
        defaultWorkspaceId: true,
      },
    },
    params: GitModel.workspaceIdParams,
    response: { 200: t.Array(GitModel.repositoryView) },
  })
  .get('/:workspaceId/git/status', ({ params, query }) => Git.getStatus(params.workspaceId, query.repo), {
    detail: {
      'summary': 'Get git status',
      'x-cradle-cli': {
        command: ['workspace', 'git', 'status'],
        defaultWorkspaceId: true,
      },
    },
    params: GitModel.workspaceIdParams,
    query: GitModel.repositoryQuery,
    response: { 200: GitModel.statusView },
  })
  .get('/:workspaceId/git/branches', ({ params, query }) => Git.getBranches(params.workspaceId, query.repo), {
    detail: {
      'summary': 'Get git branches',
      'x-cradle-cli': {
        command: ['workspace', 'git', 'branches'],
        defaultWorkspaceId: true,
      },
    },
    params: GitModel.workspaceIdParams,
    query: GitModel.repositoryQuery,
    response: { 200: GitModel.branchesView },
  })
  .get('/:workspaceId/git/remotes', ({ params, query }) => Git.getRemotes(params.workspaceId, query.repo), {
    detail: {
      summary: 'Get git remotes',
    },
    params: GitModel.workspaceIdParams,
    query: GitModel.repositoryQuery,
    response: { 200: GitModel.remotesView },
  })
  .get('/:workspaceId/git/graph', ({ params, query }) => Git.getGraph(params.workspaceId, query.limit ?? 100, query.repo), {
    detail: {
      'summary': 'Get git graph',
      'x-cradle-cli': {
        command: ['workspace', 'git', 'graph'],
        defaultWorkspaceId: true,
      },
    },
    params: GitModel.workspaceIdParams,
    query: GitModel.graphQuery,
    response: { 200: t.Array(GitModel.graphCommitView) },
  })
  .post('/:workspaceId/git/checkout', async ({ params, body }) => {
    await Git.checkout(params.workspaceId, body.branch, body.repo)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Checkout branch',
      'x-cradle-cli': {
        command: ['workspace', 'git', 'checkout'],
        defaultWorkspaceId: true,
      },
    },
    params: GitModel.workspaceIdParams,
    body: GitModel.checkoutBody,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
  .post('/:workspaceId/git/branches', async ({ params, body }) => {
    await Git.createBranch(params.workspaceId, body.name, body.from, body.repo)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Create branch',
      'x-cradle-cli': {
        command: ['workspace', 'git', 'branch', 'create'],
        defaultWorkspaceId: true,
      },
    },
    params: GitModel.workspaceIdParams,
    body: GitModel.createBranchBody,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
  .post('/:workspaceId/git/fetch', async ({ params, body }) => {
    await Git.fetch(params.workspaceId, body?.repo)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Fetch remote',
      'x-cradle-cli': {
        command: ['workspace', 'git', 'fetch'],
        defaultWorkspaceId: true,
      },
    },
    params: GitModel.workspaceIdParams,
    body: GitModel.fetchBody,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
  .get('/:workspaceId/git/diff', async ({ params, query }) => {
    const paths = query.paths ? query.paths.split(',').map(p => p.trim()).filter(Boolean) : undefined
    return await Git.getDiff(params.workspaceId, paths, query.repo)
  }, {
    detail: {
      'summary': 'Get git diff',
      'x-cradle-cli': {
        command: ['workspace', 'git', 'diff'],
        defaultWorkspaceId: true,
      },
    },
    params: GitModel.workspaceIdParams,
    query: GitModel.diffQuery,
    response: { 200: t.String() },
  })
  .get('/:workspaceId/git/merge-base', ({ params, query }) => Git.getMergeBase(params.workspaceId, query.baseBranch, query.repo), {
    detail: {
      summary: 'Get git merge base',
    },
    params: GitModel.workspaceIdParams,
    query: GitModel.mergeBaseQuery,
    response: { 200: GitModel.mergeBaseView },
  })
  .get('/:workspaceId/git/branch-compare', ({ params, query }) => {
    return Git.getBranchCompare(params.workspaceId, query.baseRef, query.headRef, query.repo)
  }, {
    detail: {
      summary: 'Get git branch compare diff',
    },
    params: GitModel.workspaceIdParams,
    query: GitModel.branchCompareQuery,
    response: { 200: GitModel.branchCompareView },
  })
