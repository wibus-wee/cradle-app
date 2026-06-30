import { Elysia, t } from 'elysia'
import { z } from 'zod'

import { resolveActorContext } from '../../http/actor-context'
import { IssueModel } from './model'
import * as Issue from './service'

const IssueLabelsQuerySchema = z.union([
  z.string().transform(value => value.split(',').map(item => item.trim()).filter(Boolean)),
  z.array(z.string().transform(item => item.trim()).pipe(z.string().min(1))),
]).optional()

export const issue = new Elysia({
  prefix: '/issues',
  detail: { tags: ['issue'] },
})
  .get('/statuses', ({ query }) => Issue.listStatuses(query.workspaceId), {
    detail: {
      'summary': 'List issue statuses',
      'x-cradle-cli': { command: ['issue', 'status', 'list'] },
    },
    query: IssueModel.optionalWorkspaceIdQuery,
    response: { 200: t.Array(IssueModel.status) },
  })
  .post('/statuses', ({ body }) => Issue.createStatus(body), {
    detail: {
      'summary': 'Create issue status',
      'x-cradle-cli': { command: ['issue', 'status', 'create'] },
    },
    body: IssueModel.createStatusBody,
    response: { 200: IssueModel.status },
  })
  .post('/statuses/reorder', ({ body }) => {
    Issue.reorderStatuses(body.workspaceId, body.orderedIds)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Reorder issue statuses',
      'x-cradle-cli': { command: ['issue', 'status', 'reorder'] },
    },
    body: IssueModel.reorderStatusesBody,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
  .patch('/statuses/:id', ({ params, body }) => Issue.updateStatus(params.id, body), {
    detail: {
      'summary': 'Update issue status',
      'x-cradle-cli': { command: ['issue', 'status', 'update'] },
    },
    params: IssueModel.idParams,
    body: IssueModel.updateStatusBody,
    response: { 200: IssueModel.status },
  })
  .delete('/statuses/:id', ({ params }) => {
    Issue.deleteStatus(params.id)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Delete issue status',
      'x-cradle-cli': { command: ['issue', 'status', 'delete'] },
    },
    params: IssueModel.idParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
  .get('/milestones', ({ query }) => Issue.listMilestones(query.workspaceId), {
    detail: {
      'summary': 'List issue milestones',
      'x-cradle-cli': { command: ['issue', 'milestone', 'list'] },
    },
    query: IssueModel.optionalWorkspaceIdQuery,
    response: { 200: t.Array(IssueModel.milestone) },
  })
  .post('/milestones', ({ body }) => Issue.createMilestone(body), {
    detail: {
      'summary': 'Create issue milestone',
      'x-cradle-cli': { command: ['issue', 'milestone', 'create'] },
    },
    body: IssueModel.createMilestoneBody,
    response: { 200: IssueModel.milestone },
  })
  .patch('/milestones/:id', ({ params, body }) => Issue.updateMilestone(params.id, body), {
    detail: {
      'summary': 'Update issue milestone',
      'x-cradle-cli': { command: ['issue', 'milestone', 'update'] },
    },
    params: IssueModel.idParams,
    body: IssueModel.updateMilestoneBody,
    response: { 200: IssueModel.milestone },
  })
  .delete('/milestones/:id', ({ params }) => {
    Issue.deleteMilestone(params.id)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Delete issue milestone',
      'x-cradle-cli': { command: ['issue', 'milestone', 'delete'] },
    },
    params: IssueModel.idParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
  .get('/search', ({ query }) => Issue.searchIssues(query.q, Number(query.limit) || 20), {
    detail: {
      'summary': 'Search issues',
      'x-cradle-cli': { command: ['issue', 'search'] },
    },
    query: t.Object({ q: t.String(), limit: t.Optional(t.String()) }),
    response: { 200: t.Array(IssueModel.issue) },
  })
  .get('/', ({ query }) => Issue.listIssues({
    workspaceId: query.workspaceId,
    milestoneId: query.milestoneId,
    parentIssueId: query.parentIssueId,
    priority: query.priority,
    labels: IssueLabelsQuerySchema.parse(query.labels),
    statusId: query.statusId,
  }), {
    detail: {
      'summary': 'List issues',
      'x-cradle-cli': { command: ['issue', 'list'] },
    },
    query: IssueModel.listIssuesQuery,
    response: { 200: t.Array(IssueModel.issue) },
  })
  .get('/:id', ({ params }) => Issue.getIssue(params.id), {
    detail: {
      'summary': 'Get issue',
      'x-cradle-cli': { command: ['issue', 'get'] },
    },
    params: IssueModel.idParams,
    response: { 200: IssueModel.issue },
  })
  .get('/:id/sessions', ({ params }) => Issue.listLinkedSessions(params.id), {
    detail: {
      summary: 'List linked chat sessions for an issue',
    },
    params: IssueModel.idParams,
    response: { 200: t.Array(IssueModel.linkedSession) },
  })
  .post('/', ({ body, request }) => Issue.createIssue(body, resolveActorContext(request)), {
    detail: {
      'summary': 'Create issue',
      'x-cradle-cli': { command: ['issue', 'create'] },
    },
    body: IssueModel.createIssueBody,
    response: { 200: IssueModel.issue },
  })
  .patch('/bulk', ({ body, request }) => {
    const updated = Issue.bulkUpdateIssues(body.issueIds, body.update, resolveActorContext(request))
    return { updated }
  }, {
    detail: { summary: 'Bulk update issues' },
    body: IssueModel.bulkUpdateBody,
    response: { 200: t.Object({ updated: t.Number() }) },
  })
  .patch('/:id/status/:statusName', ({ params, request }) => Issue.moveIssueToStatusName(params.id, params.statusName, resolveActorContext(request)), {
    detail: {
      'summary': 'Move issue to status by name',
      'x-cradle-cli': { command: ['issue', 'move'] },
    },
    params: IssueModel.moveIssueByStatusNameParams,
    response: { 200: IssueModel.issue },
  })
  .patch('/:id', ({ params, body, request }) => Issue.updateIssue(params.id, body, resolveActorContext(request)), {
    detail: {
      'summary': 'Update issue',
      'x-cradle-cli': { command: ['issue', 'update'] },
    },
    params: IssueModel.idParams,
    body: IssueModel.updateIssueBody,
    response: { 200: IssueModel.issue },
  })
  .get('/:id/activity', ({ params }) => Issue.listActivity(params.id), {
    detail: {
      'summary': 'List issue activity',
      'x-cradle-cli': { command: ['issue', 'activity', 'list'] },
    },
    params: IssueModel.idParams,
    response: { 200: t.Array(IssueModel.activityItem) },
  })
  .get('/:id/field-changes', ({ params }) => Issue.listFieldChanges(params.id), {
    detail: {
      'summary': 'List issue field changes',
      'x-cradle-cli': { command: ['issue', 'field-change', 'list'] },
    },
    params: IssueModel.idParams,
    response: { 200: t.Array(IssueModel.fieldChange) },
  })
  .delete('/:id', ({ params }) => {
    Issue.deleteIssue(params.id)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Delete issue',
      'x-cradle-cli': { command: ['issue', 'delete'] },
    },
    params: IssueModel.idParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
  .get('/:id/comments', ({ params }) => Issue.listComments(params.id), {
    detail: {
      'summary': 'List issue comments',
      'x-cradle-cli': { command: ['issue', 'comment', 'list'] },
    },
    params: IssueModel.idParams,
    response: { 200: t.Array(IssueModel.comment) },
  })
  .post('/:id/comments', ({ params, body, request }) => {
    const actor = resolveActorContext(request)
    return Issue.addComment({
      issueId: params.id,
      content: body.content,
      authorKind: actor.kind,
      authorId: actor.id,
      sourceChatSessionId: actor.chatSessionId,
    })
  }, {
    detail: {
      'summary': 'Add issue comment',
      'x-cradle-cli': { command: ['issue', 'comment', 'add'] },
    },
    params: IssueModel.idParams,
    body: IssueModel.addCommentBody,
    response: { 200: IssueModel.comment },
  })
  .delete('/comments/:id', ({ params }) => {
    Issue.deleteComment(params.id)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Delete issue comment',
      'x-cradle-cli': { command: ['issue', 'comment', 'delete'] },
    },
    params: IssueModel.idParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
  .get('/:id/relations', ({ params }) => Issue.listRelations(params.id), {
    detail: {
      'summary': 'List issue relations',
      'x-cradle-cli': { command: ['issue', 'relation', 'list'] },
    },
    params: IssueModel.idParams,
    response: { 200: t.Array(IssueModel.relation) },
  })
  .post('/relations', ({ body }) => Issue.createRelation(body), {
    detail: {
      'summary': 'Create issue relation',
      'x-cradle-cli': { command: ['issue', 'relation', 'create'] },
    },
    body: IssueModel.createRelationBody,
    response: { 200: IssueModel.relation },
  })
  .delete('/relations/:id', ({ params }) => {
    Issue.deleteRelation(params.id)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Delete issue relation',
      'x-cradle-cli': { command: ['issue', 'relation', 'delete'] },
    },
    params: IssueModel.idParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
  .post('/:id/context-refs', ({ params, body, request }) => Issue.addContextRef(params.id, body.ref, resolveActorContext(request)), {
    detail: {
      'summary': 'Add issue context ref',
      'x-cradle-cli': { command: ['issue', 'context-ref', 'add'] },
    },
    params: IssueModel.idParams,
    body: IssueModel.addContextRefBody,
    response: { 200: IssueModel.issue },
  })
  .delete('/:id/context-refs/:index', ({ params, request }) => Issue.removeContextRef(params.id, Number(params.index), resolveActorContext(request)), {
    detail: {
      'summary': 'Remove issue context ref',
      'x-cradle-cli': { command: ['issue', 'context-ref', 'remove'] },
    },
    params: IssueModel.contextRefIndexParams,
    response: { 200: IssueModel.issue },
  })
