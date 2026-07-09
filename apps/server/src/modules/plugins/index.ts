import { Elysia, t } from 'elysia'

import { pluginMarketplaceRoutes } from '../plugin-marketplace'
import { PluginsModel } from './model'
import * as Plugins from './service'

export const plugins = new Elysia({
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
  .post('/sources', ({ body }) => Plugins.createSource(body), {
    detail: {
      'summary': 'Add plugin source',
      'x-cradle-cli': {
        command: ['plugin', 'source', 'add'],
      },
    },
    body: PluginsModel.addPluginSourceBody,
    response: { 200: PluginsModel.addPluginSourceResult },
  })
  .post('/sources/preview', ({ body }) => Plugins.previewSource(body), {
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
  .delete('/sources/:id', ({ params }) => Plugins.removeSource(params.id), {
    detail: {
      'summary': 'Remove plugin source',
      'x-cradle-cli': {
        command: ['plugin', 'source', 'remove'],
      },
    },
    params: t.Object({
      id: t.String({ minLength: 1 }),
    }),
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
