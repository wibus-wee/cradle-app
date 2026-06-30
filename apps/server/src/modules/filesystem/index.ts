import { Elysia, t } from 'elysia'

import * as Filesystem from './service'

const DirectoryEntrySchema = t.Object({
  name: t.String(),
  path: t.String(),
  type: t.Union([t.Literal('directory'), t.Literal('file')]),
  size: t.Nullable(t.Number()),
  modifiedAt: t.Nullable(t.Number()),
})

const BrowseResultSchema = t.Object({
  current: t.String(),
  parent: t.Nullable(t.String()),
  entries: t.Array(DirectoryEntrySchema),
})

export const filesystem = new Elysia({
  prefix: '/filesystem',
  detail: { tags: ['filesystem'] },
})
  .get('/browse', async ({ query }) => {
    return Filesystem.browse(query.path)
  }, {
    detail: { summary: 'Browse directory contents' },
    query: t.Object({
      path: t.Optional(t.String()),
    }),
    response: { 200: BrowseResultSchema },
  })
  .get('/favorites', () => {
    return Filesystem.favorites()
  }, {
    detail: { summary: 'Get favorite/common directories' },
    response: {
      200: t.Array(t.Object({
        name: t.String(),
        path: t.String(),
        icon: t.String(),
      })),
    },
  })
