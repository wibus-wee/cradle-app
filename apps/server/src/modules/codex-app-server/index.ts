import { Elysia, t } from 'elysia'

export const codexAppServer = new Elysia({ prefix: '/codex' })
  .get('/app-server/resources', async () => {
    const { getCodexAppServerResources } = await import('../chat-runtime-providers/codex/app-server/resources')
    return getCodexAppServerResources()
  }, {
    detail: {
      'summary': 'Get active codex app-server process resource samples',
      'tags': ['codex'],
      'x-cradle-cli': { command: ['codex', 'app-server', 'resources'] },
    },
    response: {
      200: t.Array(t.Object({
        hostId: t.String(),
        providerTargetId: t.String(),
        scopeId: t.String(),
        running: t.Boolean(),
        pid: t.Nullable(t.Number()),
        rssMB: t.Nullable(t.Number()),
        cpuPercent: t.Nullable(t.Number()),
      })),
    },
  })
