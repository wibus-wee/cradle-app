import { Elysia, t } from 'elysia'

import { DiffReviewModel } from './model'
import * as DiffReview from './service'

export const diffReview = new Elysia({
  prefix: '/workspaces',
  detail: { tags: ['diff-review'] },
})
  .get('/:workspaceId/diff-reviews', ({ params }) => DiffReview.list(params.workspaceId), {
    detail: {
      'summary': 'List diff reviews',
      'x-cradle-cli': {
        command: ['workspace', 'diffs', 'list'],
        defaultWorkspaceId: true,
      },
    },
    params: DiffReviewModel.workspaceParams,
    response: { 200: t.Array(DiffReviewModel.review) },
  })
  .get('/:workspaceId/diff-reviews/source-readiness', ({ params }) => DiffReview.sourceReadiness(params.workspaceId), {
    detail: {
      'summary': 'List diff review source readiness',
      'x-cradle-cli': {
        command: ['workspace', 'diffs', 'readiness'],
        defaultWorkspaceId: true,
      },
    },
    params: DiffReviewModel.workspaceParams,
    response: { 200: t.Array(DiffReviewModel.readiness) },
  })
  .post('/:workspaceId/diff-reviews/local-working-tree', ({ params, body }) => {
    const input = body as { repo?: string }
    return DiffReview.refreshLocalWorkingTree(params.workspaceId, input.repo)
  }, {
    detail: {
      'summary': 'Create or refresh local working tree diff review',
      'x-cradle-cli': {
        command: ['workspace', 'diffs', 'local-working-tree'],
        defaultWorkspaceId: true,
      },
    },
    params: DiffReviewModel.workspaceParams,
    body: DiffReviewModel.localWorkingTreeBody,
    response: { 200: DiffReviewModel.review },
  })
  .post('/:workspaceId/diff-reviews/local-branch-compare', ({ params, body }) => {
    const input = body as { repo?: string, baseRef: string, headRef: string }
    return DiffReview.refreshLocalBranchCompare({
      workspaceId: params.workspaceId,
      repositoryPath: input.repo,
      baseRef: input.baseRef,
      headRef: input.headRef,
    })
  }, {
    detail: {
      'summary': 'Create or refresh local branch compare diff review',
      'x-cradle-cli': {
        command: ['workspace', 'diffs', 'branch-compare'],
        defaultWorkspaceId: true,
      },
    },
    params: DiffReviewModel.workspaceParams,
    body: DiffReviewModel.localBranchCompareBody,
    response: { 200: DiffReviewModel.review },
  })
  .post('/:workspaceId/diff-reviews/local-commit', ({ params, body }) => {
    const input = body as { repo?: string, commitRef: string }
    return DiffReview.refreshLocalCommit({
      workspaceId: params.workspaceId,
      repositoryPath: input.repo,
      commitRef: input.commitRef,
    })
  }, {
    detail: {
      'summary': 'Create or refresh local commit diff review',
      'x-cradle-cli': {
        command: ['workspace', 'diffs', 'commit'],
        defaultWorkspaceId: true,
      },
    },
    params: DiffReviewModel.workspaceParams,
    body: DiffReviewModel.localCommitBody,
    response: { 200: DiffReviewModel.review },
  })
  .post('/:workspaceId/diff-reviews/github-pull-request', ({ params, body }) => {
    const input = body as { owner: string, repo: string, number: number }
    return DiffReview.refreshGitHubPullRequest({
      workspaceId: params.workspaceId,
      owner: input.owner,
      repo: input.repo,
      number: input.number,
    })
  }, {
    detail: {
      'summary': 'Create or refresh a GitHub pull request diff review',
      'x-cradle-cli': {
        command: ['workspace', 'diffs', 'github-pull-request'],
        defaultWorkspaceId: true,
      },
    },
    params: DiffReviewModel.workspaceParams,
    body: DiffReviewModel.githubPullRequestBody,
    response: { 200: DiffReviewModel.review },
  })
  .get('/:workspaceId/diff-reviews/:reviewId', ({ params }) => DiffReview.get(params.workspaceId, params.reviewId), {
    detail: {
      'summary': 'Get diff review',
      'x-cradle-cli': {
        command: ['workspace', 'diffs', 'get'],
        defaultWorkspaceId: true,
      },
    },
    params: DiffReviewModel.reviewParams,
    response: { 200: DiffReviewModel.review },
  })
  .post('/:workspaceId/diff-reviews/:reviewId/refresh', ({ params }) => DiffReview.refresh(params.workspaceId, params.reviewId), {
    detail: {
      'summary': 'Refresh diff review source',
      'x-cradle-cli': {
        command: ['workspace', 'diffs', 'refresh'],
        defaultWorkspaceId: true,
      },
    },
    params: DiffReviewModel.reviewParams,
    response: { 200: DiffReviewModel.review },
  })
  .post('/:workspaceId/diff-reviews/:reviewId/close', ({ params }) => DiffReview.closeReview({
    workspaceId: params.workspaceId,
    reviewId: params.reviewId,
  }), {
    detail: {
      'summary': 'Close diff review',
      'x-cradle-cli': {
        command: ['workspace', 'diffs', 'close'],
        defaultWorkspaceId: true,
      },
    },
    params: DiffReviewModel.reviewParams,
    response: { 200: DiffReviewModel.review },
  })
  .post('/:workspaceId/diff-reviews/:reviewId/files/:fileId/viewed', ({ params, body }) => {
    const input = body as { viewed: boolean }
    return DiffReview.setFileViewed(params.workspaceId, params.reviewId, params.fileId, input.viewed)
  }, {
    detail: {
      'summary': 'Set diff review file viewed state',
      'x-cradle-cli': {
        command: ['workspace', 'diffs', 'file', 'viewed'],
        defaultWorkspaceId: true,
      },
    },
    params: DiffReviewModel.fileParams,
    body: DiffReviewModel.setViewedBody,
    response: { 200: DiffReviewModel.review },
  })
  .post('/:workspaceId/diff-reviews/:reviewId/threads', ({ params, body }) => {
    const input = body as {
      fileId?: string | null
      anchor?: {
        fileId: string
        side?: 'base' | 'head'
        startLine: number
        endLine?: number
        startColumn?: number
        endColumn?: number
      } | null
      bodyMarkdown: string
    }
    return DiffReview.createThread({
      workspaceId: params.workspaceId,
      reviewId: params.reviewId,
      fileId: input.fileId,
      anchor: input.anchor,
      bodyMarkdown: input.bodyMarkdown,
    })
  }, {
    detail: {
      'summary': 'Create diff review thread',
      'x-cradle-cli': {
        command: ['workspace', 'diffs', 'thread', 'create'],
        defaultWorkspaceId: true,
      },
    },
    params: DiffReviewModel.reviewParams,
    body: DiffReviewModel.createThreadBody,
    response: { 200: DiffReviewModel.review },
  })
  .post('/:workspaceId/diff-reviews/:reviewId/threads/:threadId/comments', ({ params, body }) => {
    const input = body as { bodyMarkdown: string }
    return DiffReview.addComment({
      workspaceId: params.workspaceId,
      reviewId: params.reviewId,
      threadId: params.threadId,
      bodyMarkdown: input.bodyMarkdown,
    })
  }, {
    detail: {
      'summary': 'Add diff review comment',
      'x-cradle-cli': {
        command: ['workspace', 'diffs', 'thread', 'comment'],
        defaultWorkspaceId: true,
      },
    },
    params: DiffReviewModel.threadParams,
    body: DiffReviewModel.addCommentBody,
    response: { 200: DiffReviewModel.review },
  })
  .post('/:workspaceId/diff-reviews/:reviewId/threads/:threadId/resolve', ({ params }) => {
    return DiffReview.resolveThread(params.workspaceId, params.reviewId, params.threadId)
  }, {
    detail: {
      'summary': 'Resolve diff review thread',
      'x-cradle-cli': {
        command: ['workspace', 'diffs', 'thread', 'resolve'],
        defaultWorkspaceId: true,
      },
    },
    params: DiffReviewModel.threadParams,
    response: { 200: DiffReviewModel.review },
  })
  .post('/:workspaceId/diff-reviews/:reviewId/submit', ({ params, body }) => {
    const input = body as { decision: 'approve' | 'request-changes' | 'comment', bodyMarkdown?: string | null }
    return DiffReview.submitReview({
      workspaceId: params.workspaceId,
      reviewId: params.reviewId,
      decision: input.decision,
      bodyMarkdown: input.bodyMarkdown,
    })
  }, {
    detail: {
      'summary': 'Submit a diff review decision',
      'x-cradle-cli': {
        command: ['workspace', 'diffs', 'submit'],
        defaultWorkspaceId: true,
      },
    },
    params: DiffReviewModel.reviewParams,
    body: DiffReviewModel.submitBody,
    response: { 200: DiffReviewModel.review },
  })
  .post('/:workspaceId/diff-reviews/:reviewId/merge', ({ params, body }) => {
    const input = body as { mergeMethod: 'merge' | 'squash' | 'rebase' }
    return DiffReview.mergeGitHubReview({
      workspaceId: params.workspaceId,
      reviewId: params.reviewId,
      mergeMethod: input.mergeMethod,
    })
  }, {
    detail: {
      'summary': 'Merge a GitHub pull request diff review',
      'x-cradle-cli': {
        command: ['workspace', 'diffs', 'merge'],
        defaultWorkspaceId: true,
      },
    },
    params: DiffReviewModel.reviewParams,
    body: DiffReviewModel.mergeBody,
    response: { 200: DiffReviewModel.review },
  })
  .put('/:workspaceId/diff-reviews/preferences', ({ params, body }) => {
    return DiffReview.updatePreferences({
      workspaceId: params.workspaceId,
      ...(body as {
        diffStyle?: 'split' | 'unified'
        codeTheme?: string
        fontSize?: number
        lineHeight?: number
        hideWhitespaceOnly?: boolean
        structuralHighlighting?: boolean
        collapseGeneratedFiles?: boolean
        notificationMode?: 'all-activity' | 'all-activity-by-people' | 'reviews-and-comments' | 'reviews-and-comments-by-people' | 'none'
      }),
    })
  }, {
    detail: {
      'summary': 'Update diff review preferences',
      'x-cradle-cli': {
        command: ['workspace', 'diffs', 'preferences', 'set'],
        defaultWorkspaceId: true,
      },
    },
    params: DiffReviewModel.workspaceParams,
    body: DiffReviewModel.updatePreferencesBody,
    response: { 200: DiffReviewModel.preferences },
  })
  .post('/:workspaceId/diff-reviews/:reviewId/agent-fixes', ({ params, body }) => {
    const input = body as {
      threadId?: string | null
      anchor?: {
        fileId: string
        side?: 'base' | 'head'
        startLine: number
        endLine?: number
        startColumn?: number
        endColumn?: number
      } | null
      instruction: string
      agentId?: string | null
      expectedOutput: 'working-tree-change' | 'patch-artifact'
    }
    return DiffReview.createAgentFix({
      workspaceId: params.workspaceId,
      reviewId: params.reviewId,
      threadId: input.threadId,
      anchor: input.anchor,
      instruction: input.instruction,
      agentId: input.agentId,
      expectedOutput: input.expectedOutput,
    })
  }, {
    detail: {
      'summary': 'Create diff review agent fix work order',
      'x-cradle-cli': {
        command: ['workspace', 'diffs', 'agent-fix', 'create'],
        defaultWorkspaceId: true,
      },
    },
    params: DiffReviewModel.reviewParams,
    body: DiffReviewModel.createAgentFixBody,
    response: { 200: DiffReviewModel.review },
  })
  .post('/:workspaceId/diff-reviews/:reviewId/agent-fixes/:agentFixId/start', async ({ params, body }) => {
    const input = body as {
      agentId?: string | null
      providerTargetId?: string | null
      runtimeKind?: string | null
      modelId?: string | null
      outputLocale?: DiffReview.ReviewOutputLocale | null
    }
    return await DiffReview.startAgentFix({
      workspaceId: params.workspaceId,
      reviewId: params.reviewId,
      agentFixId: params.agentFixId,
      agentId: input.agentId,
      providerTargetId: input.providerTargetId,
      runtimeKind: input.runtimeKind,
      modelId: input.modelId,
      outputLocale: input.outputLocale,
    })
  }, {
    detail: {
      'summary': 'Start diff review agent fix run',
      'x-cradle-cli': {
        command: ['workspace', 'diffs', 'agent-fix', 'start'],
        defaultWorkspaceId: true,
      },
    },
    params: DiffReviewModel.agentFixParams,
    body: DiffReviewModel.startAgentFixBody,
    response: { 200: DiffReviewModel.review },
  })
  .get('/:workspaceId/diff-reviews/:reviewId/agent-fixes/:agentFixId/artifact', ({ params }) => {
    return DiffReview.getAgentFixArtifact({
      workspaceId: params.workspaceId,
      reviewId: params.reviewId,
      agentFixId: params.agentFixId,
    })
  }, {
    detail: {
      'summary': 'Get diff review agent fix artifact',
      'x-cradle-cli': {
        command: ['workspace', 'diffs', 'agent-fix', 'artifact'],
        defaultWorkspaceId: true,
      },
    },
    params: DiffReviewModel.agentFixParams,
    response: { 200: DiffReviewModel.agentFixArtifact },
  })
  .post('/:workspaceId/diff-reviews/:reviewId/agent-fixes/:agentFixId/cancel', async ({ params }) => {
    return await DiffReview.cancelAgentFix({
      workspaceId: params.workspaceId,
      reviewId: params.reviewId,
      agentFixId: params.agentFixId,
    })
  }, {
    detail: {
      'summary': 'Cancel diff review agent fix run',
      'x-cradle-cli': {
        command: ['workspace', 'diffs', 'agent-fix', 'cancel'],
        defaultWorkspaceId: true,
      },
    },
    params: DiffReviewModel.agentFixParams,
    body: DiffReviewModel.cancelAgentFixBody,
    response: { 200: DiffReviewModel.review },
  })
  .post('/:workspaceId/diff-reviews/:reviewId/agent-fixes/:agentFixId/rerun', async ({ params, body }) => {
    const input = body as {
      agentId?: string | null
      providerTargetId?: string | null
      runtimeKind?: string | null
      modelId?: string | null
      outputLocale?: DiffReview.ReviewOutputLocale | null
    }
    return await DiffReview.rerunAgentFix({
      workspaceId: params.workspaceId,
      reviewId: params.reviewId,
      agentFixId: params.agentFixId,
      agentId: input.agentId,
      providerTargetId: input.providerTargetId,
      runtimeKind: input.runtimeKind,
      modelId: input.modelId,
      outputLocale: input.outputLocale,
    })
  }, {
    detail: {
      'summary': 'Rerun diff review agent fix',
      'x-cradle-cli': {
        command: ['workspace', 'diffs', 'agent-fix', 'rerun'],
        defaultWorkspaceId: true,
      },
    },
    params: DiffReviewModel.agentFixParams,
    body: DiffReviewModel.startAgentFixBody,
    response: { 200: DiffReviewModel.review },
  })
  .delete('/:workspaceId/diff-reviews/:reviewId/agent-fixes/:agentFixId', async ({ params }) => {
    return await DiffReview.deleteAgentFix({
      workspaceId: params.workspaceId,
      reviewId: params.reviewId,
      agentFixId: params.agentFixId,
    })
  }, {
    detail: {
      'summary': 'Delete diff review agent fix work order',
      'x-cradle-cli': {
        command: ['workspace', 'diffs', 'agent-fix', 'delete'],
        defaultWorkspaceId: true,
      },
    },
    params: DiffReviewModel.agentFixParams,
    response: { 200: DiffReviewModel.review },
  })
