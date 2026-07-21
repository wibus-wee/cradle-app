import { Elysia, t } from 'elysia'

import { getCodexAppServerResources } from '../chat-runtime-providers/codex/app-server/resources'

export const codexAppServer = new Elysia({ prefix: '/codex' })
  .get('/app-server/resources', () => getCodexAppServerResources(), {
    detail: {
      'summary': 'Get the active codex app-server process resource sample',
      'tags': ['codex'],
      'x-cradle-cli': { command: ['codex', 'app-server', 'resources'] },
    },
    response: {
      200: t.Object({
        running: t.Boolean(),
        pid: t.Nullable(t.Number()),
        rssMB: t.Nullable(t.Number()),
        cpuPercent: t.Nullable(t.Number()),
      }),
    },
  })
