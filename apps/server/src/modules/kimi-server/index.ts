import { Elysia, t } from 'elysia'

export const kimiServer = new Elysia({ prefix: '/kimi' })
  .get('/server/resources', async () => {
    const { getKimiServerResources } = await import('../chat-runtime-providers/kimi/resources')
    return getKimiServerResources()
  }, {
    detail: {
      'summary': 'Get the active kimi web host process resource sample',
      'tags': ['kimi'],
      'x-cradle-cli': { command: ['kimi', 'server', 'resources'] },
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
        url: t.Nullable(t.String()),
      })),
    },
  })
