import { Elysia, t } from 'elysia'

import { KanbanModel } from './model'
import * as Kanban from './service'

export const kanban = new Elysia({
  prefix: '/kanban',
  detail: { tags: ['kanban'] },
})
  .get('/boards', ({ query }) => Kanban.listBoards(query.workspaceId), {
    detail: {
      'summary': 'List Kanban boards',
      'x-cradle-cli': {
        command: ['board', 'list'],
      },
    },
    query: KanbanModel.workspaceIdQuery,
    response: { 200: t.Array(KanbanModel.board) },
  })
  .post('/boards', ({ body }) => Kanban.createBoard(body), {
    detail: {
      'summary': 'Create Kanban board',
      'x-cradle-cli': {
        command: ['board', 'create'],
      },
    },
    body: KanbanModel.createBoardBody,
    response: { 200: KanbanModel.board },
  })
  .delete('/boards/:id', ({ params }) => {
    Kanban.deleteBoard(params.id)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Delete Kanban board',
      'x-cradle-cli': {
        command: ['board', 'delete'],
      },
    },
    params: KanbanModel.idParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
  .patch('/boards/:id', ({ params, body }) => Kanban.updateBoard(params.id, body), {
    detail: {
      'summary': 'Update Kanban board',
      'x-cradle-cli': {
        command: ['board', 'update'],
      },
    },
    params: KanbanModel.idParams,
    body: KanbanModel.updateBoardBody,
    response: { 200: KanbanModel.board },
  })
