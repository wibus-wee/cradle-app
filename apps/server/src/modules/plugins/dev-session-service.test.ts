import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { deactivateAllPlugins } from '../../plugins/loader'
import { dispatchPluginRoute } from '../../plugins/route-registry'
import { PluginDevSessionService } from './dev-session-service'

let packageDir: string | null = null

async function writeFixture(): Promise<string> {
  packageDir = await mkdtemp(join(tmpdir(), 'cradle-plugin-dev-session-'))
  await mkdir(join(packageDir, '.cradle/dev'), { recursive: true })
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({
    name: '@cradle/dev-session-fixture',
    version: '1.0.0',
    cradle: {
      apiVersion: '1',
      server: 'dist/server.mjs',
      dev: { server: 'src/server.ts' },
      contributes: { capabilities: [], permissions: [] },
    },
  }))
  return packageDir
}

async function writeServerBundle(value: string): Promise<void> {
  await writeFile(join(packageDir!, '.cradle/dev/server.mjs'), [
    'export function activate(ctx) {',
    `  ctx.routes.register({ method: "GET", path: "/value", handler: () => ({ value: ${JSON.stringify(value)} }) })`,
    '}',
  ].join('\n'))
}

async function readRouteValue(): Promise<unknown> {
  return dispatchPluginRoute({
    routeSegment: 'dev-session-fixture',
    method: 'GET',
    path: '/value',
    body: undefined,
    query: {},
    headers: {},
    set: {},
  })
}

afterEach(async () => {
  await deactivateAllPlugins()
  if (packageDir) {
    await rm(packageDir, { recursive: true, force: true })
    packageDir = null
  }
})

describe('plugin development session service', () => {
  it('reloads a changed server bundle by revision and removes its routes on stop', async () => {
    const service = new PluginDevSessionService()
    await writeFixture()
    await writeServerBundle('v1')

    const session = await service.create({
      packageDir: packageDir!,
      entries: { server: '.cradle/dev/server.mjs' },
    })
    expect(session.revisions.server).toBe(1)
    expect(await readRouteValue()).toMatchObject({ found: true, body: { value: 'v1' } })

    await writeServerBundle('v2')
    const reloaded = await service.reload(session.id, 'server')
    expect(reloaded.revisions.server).toBe(2)
    expect(await readRouteValue()).toMatchObject({ found: true, body: { value: 'v2' } })

    await expect(service.remove(session.id)).resolves.toEqual({ removed: true })
    await expect(service.remove(session.id)).resolves.toEqual({ removed: true })
    expect(await readRouteValue()).toMatchObject({ found: false })
  })

  it('rejects two active sessions for the same plugin identity', async () => {
    const service = new PluginDevSessionService()
    await writeFixture()
    await writeServerBundle('v1')
    const input = {
      packageDir: packageDir!,
      entries: { server: '.cradle/dev/server.mjs' },
    }
    await service.create(input)
    await expect(service.create(input)).rejects.toMatchObject({
      code: 'plugin_dev_session_conflict',
      status: 409,
    })
    await service.shutdown()
  })
})

describe('pluginDevSessionService subscription', () => {
  it('publishes session events and removes unsubscribed listeners', async () => {
    await writeFixture()
    await writeServerBundle('v1')
    const service = new PluginDevSessionService()
    const listener = vi.fn()
    const unsubscribe = service.subscribe(listener)

    const session = await service.create({
      packageDir: packageDir!,
      entries: { server: '.cradle/dev/server.mjs' },
    })
    expect(listener).toHaveBeenCalledWith({
      type: 'started',
      layer: null,
      session,
    })

    unsubscribe()
    await service.reload(session.id, 'server')

    expect(listener).toHaveBeenCalledOnce()
    await service.shutdown()
  })
})
