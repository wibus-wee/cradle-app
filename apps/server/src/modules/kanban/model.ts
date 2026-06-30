import { t } from 'elysia'

export const KanbanModel = {
  board: t.Object({
    id: t.String(),
    workspaceId: t.String(),
    name: t.String(),
    filterConfig: t.Nullable(t.String()),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  workspaceIdQuery: t.Object({
    workspaceId: t.Optional(t.String()),
  }),

  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }),

  createBoardBody: t.Object({
    workspaceId: t.String({ minLength: 1 }),
    name: t.String({ minLength: 1 }),
    filterConfig: t.Optional(t.Nullable(t.String())),
  }),

  updateBoardBody: t.Object({
    name: t.Optional(t.String({ minLength: 1 })),
    filterConfig: t.Optional(t.Nullable(t.String())),
  }),
}
