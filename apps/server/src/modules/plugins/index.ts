import { Elysia, t } from 'elysia'

import type { PluginSourceInstallerOptions } from '../../plugins/source-installer'
import { pluginMarketplaceRoutes } from '../plugin-marketplace'
import { pluginDevSessions } from './dev-session-service'
import { PluginsModel } from './model'
import * as Plugins from './service'

export function createPluginsModule(options: PluginSourceInstallerOptions = {}) {
  return new Elysia({
  prefix: '/plugins',
  detail: { tags: ['plugins'] },
})
  .use(pluginMarketplaceRoutes)
  .get('/', () => Plugins.listPlugins(), {
    detail: {
      'summary': 'List plugins',
      'x-cradle-cli': {
        command: ['plugin', 'list'],
      },
    },
    response: { 200: t.Array(PluginsModel.pluginDescriptor) },
  })
  .get('/mentions', () => Plugins.listMentionCandidates(), {
    detail: {
      summary: 'List plugin mention candidates',
    },
    response: { 200: t.Array(PluginsModel.pluginMentionCandidate) },
  })
  .get('/sources', () => Plugins.listSources(), {
    detail: {
      'summary': 'List plugin sources',
      'x-cradle-cli': {
        command: ['plugin', 'source', 'list'],
      },
    },
    response: { 200: t.Array(PluginsModel.pluginSourceRegistryEntry) },
  })
  .get('/dev-sessions', () => pluginDevSessions.list(), {
    detail: { summary: 'List active plugin development sessions' },
    response: { 200: t.Array(PluginsModel.pluginDevSession) },
  })
  .post('/dev-sessions', ({ body }) => pluginDevSessions.create(body), {
    detail: { summary: 'Start a temporary plugin development session' },
    body: PluginsModel.createPluginDevSessionBody,
    response: { 200: PluginsModel.pluginDevSession },
  })
  .post('/dev-sessions/:id/reload', ({ body, params }) => pluginDevSessions.reload(params.id, body.layer), {
    detail: { summary: 'Reload a built plugin development layer' },
    params: t.Object({ id: t.String({ minLength: 1 }) }),
    body: PluginsModel.reloadPluginDevSessionBody,
    response: { 200: PluginsModel.pluginDevSession },
  })
  .post('/dev-sessions/:id/heartbeat', ({ params }) => pluginDevSessions.heartbeat(params.id), {
    detail: { summary: 'Keep a plugin development session alive' },
    params: t.Object({ id: t.String({ minLength: 1 }) }),
    response: { 200: PluginsModel.pluginDevSession },
  })
  .delete('/dev-sessions/:id', ({ params }) => pluginDevSessions.remove(params.id), {
    detail: { summary: 'Stop a temporary plugin development session' },
    params: t.Object({ id: t.String({ minLength: 1 }) }),
    response: { 200: t.Object({ removed: t.Literal(true) }) },
  })
  .get('/dev-sessions/events', ({ request }) => new Response(pluginDevSessions.stream(request.signal), {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
    },
  }), {
    detail: { summary: 'Subscribe to plugin development session changes' },
  })
  .post('/sources', ({ body }) => Plugins.createSource(body, options), {
    detail: {
      'summary': 'Add plugin source',
      'x-cradle-cli': {
        command: ['plugin', 'source', 'add'],
      },
    },
    body: PluginsModel.addPluginSourceBody,
    response: { 200: PluginsModel.addPluginSourceResult },
  })
  .post('/sources/preview', ({ body }) => Plugins.previewSource(body, options), {
    detail: {
      summary: 'Preview plugin source (no install)',
    },
    body: PluginsModel.previewPluginSourceBody,
    response: { 200: PluginsModel.pluginSourcePreview },
  })
  .get('/sources/:id', ({ params }) => Plugins.getSource(params.id), {
    detail: {
      'summary': 'Get plugin source',
      'x-cradle-cli': {
        command: ['plugin', 'source', 'get'],
      },
    },
    params: t.Object({
      id: t.String({ minLength: 1 }),
    }),
    response: { 200: PluginsModel.pluginSourceRegistryEntry },
  })
  .post('/sources/:id/refresh', ({ params }) => Plugins.refreshSource(params.id, options), {
    detail: {
      'summary': 'Refresh plugin source',
      'x-cradle-cli': {
        command: ['plugin', 'source', 'refresh'],
      },
    },
    params: t.Object({
      id: t.String({ minLength: 1 }),
    }),
    response: { 200: PluginsModel.addPluginSourceResult },
  })
  .get('/sources/:id/uninstall-plan', ({ params }) => Plugins.inspectSourceRemoval(params.id), {
    detail: {
      'summary': 'Inspect plugin source uninstall effects',
      'x-cradle-cli': {
        command: ['plugin', 'source', 'uninstall-plan'],
      },
    },
    params: t.Object({
      id: t.String({ minLength: 1 }),
    }),
    response: { 200: PluginsModel.pluginSourceRemovalPlan },
  })
  .delete('/sources/:id', ({ params, body }) => Plugins.removeSource(params.id, body), {
    detail: {
      'summary': 'Remove plugin source',
      'x-cradle-cli': {
        command: ['plugin', 'source', 'remove'],
      },
    },
    params: t.Object({
      id: t.String({ minLength: 1 }),
    }),
    body: PluginsModel.removePluginSourceBody,
    response: { 200: t.Object({ removed: t.Literal(true) }) },
  })
  .get('/:routeSegment/icon', async ({ params }) => {
    const icon = await Plugins.readPluginIcon(params.routeSegment)
    const body = icon.bytes.buffer.slice(
      icon.bytes.byteOffset,
      icon.bytes.byteOffset + icon.bytes.byteLength,
    ) as ArrayBuffer
    return new Response(body, {
      headers: {
        'content-type': icon.mimeType,
        'cache-control': 'no-store',
        'content-length': String(icon.bytes.byteLength),
      },
    })
  }, {
    detail: {
      summary: 'Read plugin icon asset',
    },
    params: t.Object({
      routeSegment: t.String({ minLength: 1 }),
    }),
  })
  .get('/:routeSegment', ({ params }) => Plugins.getPlugin(params.routeSegment), {
    detail: {
      'summary': 'Get plugin descriptor',
      'x-cradle-cli': {
        command: ['plugin', 'get'],
      },
    },
    params: t.Object({
      routeSegment: t.String({ minLength: 1 }),
    }),
    response: { 200: PluginsModel.pluginDescriptor },
  })
  .patch('/:routeSegment/enabled', ({ params, body }) => Plugins.setPluginEnabled(params.routeSegment, body), {
    detail: {
      'summary': 'Set plugin activation',
      'x-cradle-cli': {
        command: ['plugin', 'set-enabled'],
      },
    },
    params: t.Object({
      routeSegment: t.String({ minLength: 1 }),
    }),
    body: PluginsModel.updatePluginActivationBody,
    response: { 200: PluginsModel.pluginDescriptor },
  })
  .onStop(() => pluginDevSessions.shutdown())
}
