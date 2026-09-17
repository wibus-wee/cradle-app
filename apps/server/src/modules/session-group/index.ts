import { Elysia, t } from 'elysia'

import { AppError } from '../../errors/app-error'
import { SessionGroupModel } from './model'
import * as SessionGroup from './service'

export const sessionGroup = new Elysia({
  prefix: '/session-groups',
  detail: { tags: ['session-group'] },
})
  .get('', ({ query }) => SessionGroup.list(query), {
    detail: {
      'summary': 'List session groups',
      'x-cradle-cli': {
        command: ['session-group', 'list'],
      },
    },
    query: SessionGroupModel.listQuery,
    response: { 200: t.Array(SessionGroupModel.sessionGroup) },
  })
  .get(
    '/:id',
    ({ params }) => {
      const group = SessionGroup.get(params.id)
      if (!group) {
        throw new AppError({
          code: 'session_group_not_found',
          status: 404,
          message: 'Session group not found',
        })
      }
      return group
    },
    {
      detail: {
        'summary': 'Get session group by ID',
        'x-cradle-cli': {
          command: ['session-group', 'get'],
        },
      },
      params: SessionGroupModel.idParams,
      response: { 200: SessionGroupModel.sessionGroupDetail },
    },
  )
  .post('', ({ body }) => SessionGroup.create(body), {
    detail: {
      'summary': 'Create session group',
      'x-cradle-cli': {
        command: ['session-group', 'create'],
      },
    },
    body: SessionGroupModel.createBody,
    response: { 200: SessionGroupModel.sessionGroupDetail },
  })
  .patch(
    '/:id',
    ({ params, body }) => {
      if (
        body.title === undefined
        && body.description === undefined
        && body.linkedIssueId === undefined
        && body.archived === undefined
      ) {
        throw new AppError({
          code: 'invalid_session_group_input',
          status: 400,
          message: 'at least one session group field is required',
        })
      }
      const result = SessionGroup.update({ id: params.id, ...body })
      if (!result) {
        throw new AppError({
          code: 'session_group_not_found',
          status: 404,
          message: 'Session group not found',
        })
      }
      return result
    },
    {
      detail: {
        'summary': 'Update session group',
        'x-cradle-cli': {
          command: ['session-group', 'update'],
        },
      },
      params: SessionGroupModel.idParams,
      body: SessionGroupModel.updateBody,
      response: { 200: SessionGroupModel.updateResponse },
    },
  )
  .delete(
    '/:id',
    ({ params }) => {
      SessionGroup.remove(params.id)
      return { ok: true as const }
    },
    {
      detail: {
        'summary': 'Delete session group',
        'x-cradle-cli': {
          command: ['session-group', 'delete'],
        },
      },
      params: SessionGroupModel.idParams,
      response: { 200: t.Object({ ok: t.Literal(true) }) },
    },
  )
  .post(
    '/:id/members',
    ({ params, body }) => SessionGroup.addMembers(params.id, body.sessionIds),
    {
      detail: {
        'summary': 'Add sessions to session group',
        'x-cradle-cli': {
          command: ['session-group', 'add-member'],
        },
      },
      params: SessionGroupModel.idParams,
      body: SessionGroupModel.addMembersBody,
      response: { 200: SessionGroupModel.sessionGroupDetail },
    },
  )
  .delete(
    '/:id/members/:sessionId',
    ({ params }) => {
      const group = SessionGroup.removeMember(params.id, params.sessionId)
      if (!group) {
        throw new AppError({
          code: 'session_group_not_found',
          status: 404,
          message: 'Session group not found',
        })
      }
      return group
    },
    {
      detail: {
        'summary': 'Remove session from session group',
        'x-cradle-cli': {
          command: ['session-group', 'remove-member'],
        },
      },
      params: SessionGroupModel.memberParams,
      response: { 200: SessionGroupModel.sessionGroupDetail },
    },
  )
