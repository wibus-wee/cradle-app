/* Verifies host-owned plugin management HTTP APIs. */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createServerContractApp } from '../src/app'
import { setPluginActivationPolicy } from '../src/plugins/activation-policy'
import { deactivateAllPlugins } from '../src/plugins/loader'

let tempPluginsDir: string | undefined

async function writeManagedPluginPackage(): Promise<string> {
  const pluginsRoot = await mkdtemp(join(tmpdir(), 'cradle-plugin-api-'))
  const pluginDir = join(pluginsRoot, 'plugin-api')
  await mkdir(pluginDir, { recursive: true })
  await writeFile(
    join(pluginDir, 'package.json'),
    JSON.stringify({
      name: '@cradle/plugin-api',
      type: 'module',
      version: '1.0.0',
      cradle: {
        apiVersion: '1',
        server: 'server.mjs',
        contributes: {
          capabilities: [{
            id: 'mcp.plugin-api',
            type: 'mcp-server',
            layer: 'server',
            permissions: [],
          }],
          permissions: [],
        },
      },
    }),
  )
  await writeFile(
    join(pluginDir, 'server.mjs'),
    [
      'export function activate(ctx) {',
      '  ctx.mcp.registerServer({ transport: "stdio", name: "plugin-api", command: "node", args: ["server.mjs"] })',
      '  ctx.routes.register({ method: "GET", path: "/status", handler: () => ({ ok: true }) })',
      '}',
    ].join('\n'),
  )
  return pluginsRoot
}

async function json(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>
}

describe('plugin management API', () => {
  afterEach(async () => {
    await deactivateAllPlugins()
    setPluginActivationPolicy('@cradle/plugin-api', { enabled: true, reason: null })
    delete process.env.CRADLE_PLUGINS_DIR
    delete process.env.CRADLE_PLUGINS_SOURCE_KIND
    if (tempPluginsDir) {
      await rm(tempPluginsDir, { recursive: true, force: true })
      tempPluginsDir = undefined
    }
  })

  it('lists, gets, disables, and re-enables plugins by route segment', async () => {
    tempPluginsDir = await writeManagedPluginPackage()
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'workspaceDev'

    const app = await createServerContractApp({ includeRuntimeHttpPlugins: true })
    const { activateServerPlugins } = await import('../src/plugins/loader')
    await activateServerPlugins(app)

    const listResponse = await app.handle(new Request('http://localhost/plugins/'))
    expect(listResponse.status).toBe(200)
    const plugins = await json(listResponse) as Array<{ identity: string, activation: { enabled: boolean } }>
    expect(plugins).toContainEqual(expect.objectContaining({
      identity: '@cradle/plugin-api',
      activation: expect.objectContaining({ enabled: true }),
    }))

    const getResponse = await app.handle(new Request('http://localhost/plugins/api'))
    expect(getResponse.status).toBe(200)
    expect(await json(getResponse)).toMatchObject({
      identity: '@cradle/plugin-api',
      routeSegment: 'api',
      active: true,
      layers: {
        server: { status: 'active' },
      },
    })

    const activeRouteResponse = await app.handle(new Request('http://localhost/api/plugins/api/status'))
    expect(activeRouteResponse.status).toBe(200)
    expect(await activeRouteResponse.json()).toEqual({ ok: true })

    const activeMentionsResponse = await app.handle(new Request('http://localhost/plugins/mentions'))
    const activeMentions = await json(activeMentionsResponse) as Array<{ pluginName: string }>
    expect(activeMentions.some(plugin => plugin.pluginName === '@cradle/plugin-api')).toBe(true)

    const disableResponse = await app.handle(new Request('http://localhost/plugins/api/enabled', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false, reason: 'api test' }),
    }))
    expect(disableResponse.status).toBe(200)
    expect(await json(disableResponse)).toMatchObject({
      activation: {
        enabled: false,
        source: 'user',
        reason: 'api test',
      },
      active: false,
      layers: {
        server: { status: 'disabled' },
      },
    })

    const disabledRouteResponse = await app.handle(new Request('http://localhost/api/plugins/api/status'))
    expect(disabledRouteResponse.status).toBe(404)

    const disabledMentionsResponse = await app.handle(new Request('http://localhost/plugins/mentions'))
    const disabledMentions = await json(disabledMentionsResponse) as Array<{ pluginName: string }>
    expect(disabledMentions.some(plugin => plugin.pluginName === '@cradle/plugin-api')).toBe(false)

    const enableResponse = await app.handle(new Request('http://localhost/plugins/api/enabled', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    }))
    expect(enableResponse.status).toBe(200)
    expect(await json(enableResponse)).toMatchObject({
      activation: {
        enabled: true,
        source: 'user',
      },
      active: true,
      layers: {
        server: { status: 'active' },
      },
    })
    expect((await app.handle(new Request('http://localhost/api/plugins/api/status'))).status).toBe(200)
  })
})
