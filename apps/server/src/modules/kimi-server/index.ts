import { Elysia, t } from 'elysia'

import { getKimiServerResources } from '../chat-runtime-providers/kimi/resources'

export const kimiServer = new Elysia({ prefix: '/kimi' })
  .get('/server/resources', () => getKimiServerResources(), {
    detail: {
      'summary': 'Get the active kimi web host process resource sample',
      'tags': ['kimi'],
      'x-cradle-cli': { command: ['kimi', 'server', 'resources'] },
    },
    response: {
      200: t.Object({
        running: t.Boolean(),
        pid: t.Nullable(t.Number()),
        rssMB: t.Nullable(t.Number()),
        cpuPercent: t.Nullable(t.Number()),
        url: t.Nullable(t.String()),
      }),
    },
  })
