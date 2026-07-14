import { Elysia, t } from 'elysia'

import { getOpencodeServerResources } from '../chat-runtime-providers/opencode/runtime-context'

export const opencodeServer = new Elysia({ prefix: '/opencode' })
  .get('/server/resources', () => getOpencodeServerResources(), {
    detail: {
      'summary': 'Get one active pooled opencode host process resource sample',
      'tags': ['opencode'],
      'x-cradle-cli': { command: ['opencode', 'server', 'resources'] },
    },
    response: {
      200: t.Object({
        running: t.Boolean(),
        pid: t.Nullable(t.Number()),
        url: t.Nullable(t.String()),
        startedAt: t.Nullable(t.Number()),
        uptimeSeconds: t.Nullable(t.Number()),
        rssMB: t.Nullable(t.Number()),
        cpuPercent: t.Nullable(t.Number()),
      }),
    },
  })
