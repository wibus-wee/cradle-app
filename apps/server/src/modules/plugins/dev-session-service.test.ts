import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

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

describe('pluginDevSessionService stream', () => {
  it('flushes an open comment immediately so clients receive headers without waiting for events', async () => {
    const service = new PluginDevSessionService()
    const abortController = new AbortController()
    const reader = service.stream(abortController.signal).getReader()
    const decoder = new TextDecoder()

    const first = await reader.read()
    expect(first.done).toBe(false)
    expect(decoder.decode(first.value)).toBe(': cradle-event-stream-open\n\n')

    abortController.abort()
    await expect(reader.read()).resolves.toMatchObject({ done: true })
    await service.shutdown()
  })

  it('forwards published session events after the open comment', async () => {
    await writeFixture()
    await writeServerBundle('v1')
    const service = new PluginDevSessionService()
    const abortController = new AbortController()
    const reader = service.stream(abortController.signal).getReader()
    const decoder = new TextDecoder()

    const open = await reader.read()
    expect(decoder.decode(open.value)).toBe(': cradle-event-stream-open\n\n')

    const session = await service.create({
      packageDir: packageDir!,
      entries: { server: '.cradle/dev/server.mjs' },
    })

    const event = await reader.read()
    expect(event.done).toBe(false)
    expect(JSON.parse(decoder.decode(event.value!).replace(/^data:\s*/, '').trim())).toEqual({
      type: 'started',
      layer: null,
      session,
    })

    abortController.abort()
    await service.shutdown()
  })
})
