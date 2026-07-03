import { Elysia, t } from 'elysia'

import { AppError } from '../../errors/app-error'
import * as Issue from '../issue/service'
import { SessionModel } from './model'
import * as Session from './service'

export const session = new Elysia({
  prefix: '/sessions',
  detail: { tags: ['session'] }
})
  .get('/', ({ query }) => Session.list(query), {
    detail: {
      summary: 'List sessions',
      'x-cradle-cli': {
        command: ['session', 'list']
      }
    },
    query: SessionModel.listQuery,
    response: { 200: t.Array(SessionModel.session) }
  })
  .get(
    '/:id',
    ({ params }) => {
      const s = Session.get(params.id)
      if (!s) {
        throw new AppError({ code: 'session_not_found', status: 404, message: 'Session not found' })
      }
      return s
    },
    {
      detail: {
        summary: 'Get session by ID',
        'x-cradle-cli': {
          command: ['session', 'get']
        }
      },
      params: SessionModel.idParams,
      response: { 200: SessionModel.session }
    }
  )
  .post('/', ({ body }) => Session.create(body), {
    detail: {
      summary: 'Create session',
      'x-cradle-cli': {
        command: ['session', 'create']
      }
    },
    body: SessionModel.createBody,
    response: { 200: SessionModel.session }
  })
  .patch(
    '/:id',
    async ({ params, body }) => {
      if (
        body.title === undefined &&
        body.pinned === undefined &&
        body.providerTargetId === undefined &&
        body.modelId === undefined &&
        body.thinkingEffort === undefined
      ) {
        throw new AppError({
          code: 'invalid_session_input',
          status: 400,
          message: 'at least one session field is required'
        })
      }
      const result = await Session.update({ id: params.id, ...body })
      if (!result) {
        throw new AppError({ code: 'session_not_found', status: 404, message: 'Session not found' })
      }
      return result
    },
    {
      detail: {
        summary: 'Update session',
        'x-cradle-cli': {
          command: ['session', 'update']
        }
      },
      params: SessionModel.idParams,
      body: SessionModel.updateBody,
      response: { 200: SessionModel.session }
    }
  )
  .post(
    '/:id/archive',
    ({ params, body }) => {
      const result = Session.setArchived({ id: params.id, archived: body.archived })
      if (!result) {
        throw new AppError({ code: 'session_not_found', status: 404, message: 'Session not found' })
      }
      return result
    },
    {
      detail: {
        summary: 'Archive or restore session',
        'x-cradle-cli': {
          command: ['session', 'archive']
        }
      },
      params: SessionModel.idParams,
      body: SessionModel.archiveBody,
      response: { 200: SessionModel.session }
    }
  )
  .post(
    '/:id/read',
    ({ params }) => {
      const result = Session.markRead(params.id)
      if (!result) {
        throw new AppError({ code: 'session_not_found', status: 404, message: 'Session not found' })
      }
      return result
    },
    {
      detail: {
        summary: 'Mark session as read'
      },
      params: SessionModel.idParams,
      response: { 200: SessionModel.session }
    }
  )
  .post(
    '/:id/unread',
    ({ params }) => {
      const result = Session.markUnread(params.id)
      if (!result) {
        throw new AppError({ code: 'session_not_found', status: 404, message: 'Session not found' })
      }
      return result
    },
    {
      detail: {
        summary: 'Mark session as unread'
      },
      params: SessionModel.idParams,
      response: { 200: SessionModel.session }
    }
  )
  .delete(
    '/:id',
    ({ params }) => {
      Session.remove(params.id)
      return { ok: true as const }
    },
    {
      detail: {
        summary: 'Delete session',
        'x-cradle-cli': {
          command: ['session', 'delete']
        }
      },
      params: SessionModel.idParams,
      response: { 200: t.Object({ ok: t.Literal(true) }) }
    }
  )
  .get('/:id/export/markdown', ({ params }) => ({ markdown: Session.exportMarkdown(params.id) }), {
    detail: {
      summary: 'Export session as markdown',
      'x-cradle-cli': {
        command: ['session', 'export', 'markdown']
      }
    },
    params: SessionModel.idParams,
    response: { 200: SessionModel.exportMarkdownResponse }
  })

  // ── linked issue ──
  .get('/:id/linked-issue', ({ params }) => Issue.getLinkedIssue(params.id), {
    detail: {
      summary: 'Get linked issue',
      'x-cradle-cli': {
        command: ['session', 'linked-issue', 'get']
      }
    },
    params: SessionModel.idParams,
    response: { 200: t.Object({ issueId: t.Nullable(t.String()) }) }
  })
  .post('/:id/linked-issue', ({ params, body }) => Issue.linkIssue(params.id, body.issueId), {
    detail: {
      summary: 'Link issue to session',
      'x-cradle-cli': {
        command: ['session', 'linked-issue', 'link']
      }
    },
    params: SessionModel.idParams,
    body: t.Object({ issueId: t.String({ minLength: 1 }) }),
    response: { 200: t.Object({ ok: t.Literal(true) }) }
  })
  .delete('/:id/linked-issue', ({ params }) => Issue.unlinkIssue(params.id), {
    detail: {
      summary: 'Unlink issue from session',
      'x-cradle-cli': {
        command: ['session', 'linked-issue', 'unlink']
      }
    },
    params: SessionModel.idParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) }
  })
