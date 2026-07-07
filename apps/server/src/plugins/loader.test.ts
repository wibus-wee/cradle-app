/* Verifies server plugin activation and shutdown cleanup behavior. */

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { pluginActivationPolicies, pluginSources, relayHostEnrollments } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { afterEach, describe, expect, it } from 'vitest'

import { db } from '../infra'
import { resolveCodexRuntimeContext } from '../modules/chat-runtime-providers/codex/config/runtime-context'
import { setAppPreferences } from '../modules/preferences/service'
import { resetNativeSkillProjectionTargets } from '../modules/skills/native-skill-projection'
import { setPluginActivationPolicy } from './activation-policy'
import { activateServerPlugins, deactivateAllPlugins, disablePlugin, discoverAndActivateSource, enablePlugin, removeDiscoveredSource } from './loader'
import { getRegisteredMcpServers } from './mcp-registry'
import { calculatePluginPackageChecksum } from './package-checksum'
import { listPluginDescriptors } from './runtime-registry'
import { addPluginSource, deletePluginSource } from './source-registry'
import { deletePluginTrustGrantsForPlugin, grantPluginTrust } from './trust-grants'

let tempPluginsDir: string | undefined

interface PluginPackageOptions {
  packageName?: string
  contributes?: Record<string, unknown>
  omitContributes?: boolean
  grantedPermissions?: string[]
  packageChecksum?: string
  provenance?: boolean
  server?: boolean
  web?: boolean
  writeWebEntry?: boolean
  mcpTransport?: 'stdio' | 'streamable-http'
  serverSource?: string
  webSource?: string
}

async function writePluginPackage(options: PluginPackageOptions = {}): Promise<string> {
  const pluginsRoot = await mkdtemp(join(tmpdir(), 'cradle-plugin-loader-'))
  const pluginDir = join(pluginsRoot, 'cleanup-plugin')
  await mkdir(pluginDir, { recursive: true })
  await writeFile(
    join(pluginDir, 'package.json'),
    JSON.stringify({
      name: options.packageName ?? '@cradle/loader-cleanup',
      type: 'module',
      version: '1.0.0',
      cradle: {
        apiVersion: '1',
        server: options.server === false ? undefined : 'server.mjs',
        web: options.web === true ? 'web.mjs' : undefined,
        ...(options.omitContributes
? {}
: {
          contributes: options.contributes ?? {
            capabilities: [{
              id: 'mcp.loader-cleanup',
              type: 'mcp-server',
              layer: 'server',
              permissions: [],
            }],
            permissions: [],
          },
        }),
      },
    }),
  )
  await writeFile(
    join(pluginDir, 'server.mjs'),
    options.serverSource ?? (options.mcpTransport === 'streamable-http'
      ? [
          'export function activate(ctx) {',
          '  ctx.mcp.registerServer({ transport: "streamable-http", name: "loader-cleanup", url: "https://nowledge.example.test/mcp", headers: { Authorization: "Bearer secret-token" } })',
          '}',
        ].join('\n')
      : [
          'export function activate(ctx) {',
          '  ctx.mcp.registerServer({ transport: "stdio", name: "loader-cleanup", command: "node", args: ["server.mjs"] })',
          '}',
        ].join('\n')),
  )
  if (options.web === true && options.writeWebEntry !== false) {
    await writeFile(
      join(pluginDir, 'web.mjs'),
      options.webSource ?? 'export function activate() {}',
    )
  }
  await writeFile(
    join(pluginDir, 'SKILL.md'),
    [
      '---',
      'name: loader-cleanup-skill',
      'description: Loader cleanup skill',
      '---',
      '',
      '# Loader Cleanup Skill',
    ].join('\n'),
  )
  if (options.provenance === true) {
    await writeFile(
      join(pluginDir, 'cradle-marketplace-install.json'),
      JSON.stringify({
        schemaVersion: 1,
        installedAt: '2026-05-21T10:00:00.000Z',
        mode: 'downloaded',
        source: 'github',
        repository: 'wibus-wee/Cradle',
        path: 'plugins/loader-cleanup',
        packageName: '@cradle/loader-cleanup',
        version: '1.0.0',
        channel: 'bundled',
        ref: 'main',
        originalUrl: 'cradle://plugins/install?source=github',
        packageChecksum: options.packageChecksum,
        grantedPermissions: options.grantedPermissions,
      }),
    )
  }
  return pluginsRoot
}

async function grantLoaderCleanupPluginTrust(pluginsRoot: string): Promise<string> {
  const checksum = await calculatePluginPackageChecksum(join(pluginsRoot, 'cleanup-plugin'))
  grantPluginTrust('@cradle/loader-cleanup', checksum, 'test trust grant')
  return checksum
}

async function writeUnsupportedManifestPackage(): Promise<string> {
  const pluginsRoot = await mkdtemp(join(tmpdir(), 'cradle-plugin-loader-unsupported-'))
  const pluginDir = join(pluginsRoot, 'unsupported-plugin')
  await mkdir(pluginDir, { recursive: true })
  await writeFile(
    join(pluginDir, 'package.json'),
    JSON.stringify({
      name: '@cradle/unsupported-manifest',
      type: 'module',
      version: '1.0.0',
      cradle: {
        apiVersion: '1',
        server: 'server.mjs',
        contributes: {
          capabilities: [],
          permissions: [],
        },
        capabilities: ['legacy-capability'],
        permissions: ['legacy-permission'],
      },
    }),
  )
  await writeFile(
    join(pluginDir, 'server.mjs'),
    'export function activate() {}',
  )
  return pluginsRoot
}

async function writeBuiltinSkillPackage(root: string): Promise<string> {
  const skillDir = join(root, 'builtin-loader-skill')
  await mkdir(skillDir, { recursive: true })
  await writeFile(
    join(skillDir, 'SKILL.md'),
    [
      '---',
      'name: builtin-loader-skill',
      'description: Builtin loader skill',
      '---',
      '',
      '# Builtin Loader Skill',
    ].join('\n'),
  )
  return skillDir
}

describe('server plugin loader lifecycle', () => {
  afterEach(async () => {
    await deactivateAllPlugins()
    resetNativeSkillProjectionTargets()
    setPluginActivationPolicy('@cradle/loader-cleanup', { enabled: true, reason: null })
    deletePluginTrustGrantsForPlugin('@cradle/loader-cleanup')
    db().delete(pluginSources).run()
    db()
      .delete(pluginActivationPolicies)
      .where(eq(pluginActivationPolicies.pluginName, '@acme/live-source'))
      .run()
    deletePluginTrustGrantsForPlugin('@acme/live-source')
    db()
      .delete(relayHostEnrollments)
      .where(eq(relayHostEnrollments.id, 'plugin-loader-relay-fixture'))
      .run()
    delete process.env.CRADLE_PLUGINS_DIR
    delete process.env.CRADLE_PLUGINS_SOURCE_KIND
    delete process.env.CRADLE_EXTERNAL_PLUGINS_DIRS
    delete process.env.CRADLE_MARKETPLACE_PLUGINS_DIR
    delete process.env.CRADLE_BUILTIN_SKILLS_DIR
    delete process.env.CRADLE_PLUGIN_ALLOWED_PERMISSIONS
    delete process.env.CRADLE_PLUGIN_ALLOWED_LOADER_CLEANUP_PERMISSIONS
    if (tempPluginsDir) {
      await rm(tempPluginsDir, { recursive: true, force: true })
      tempPluginsDir = undefined
    }
  })

  it('disposes plugin registrations when all plugins deactivate', async () => {
    tempPluginsDir = await writePluginPackage()
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'workspaceDev'

    await activateServerPlugins(new Elysia())

    expect(getRegisteredMcpServers()).toHaveProperty('loader-cleanup')
    expect(listPluginDescriptors()[0]?.capabilities.map(capability => capability.type)).toEqual(['mcp-server'])

    await deactivateAllPlugins()

    expect(getRegisteredMcpServers()).not.toHaveProperty('loader-cleanup')
    expect(listPluginDescriptors()[0]?.capabilities).toHaveLength(0)
  })

  it('discovers disabled plugins without activating their server or serving their web bundle', async () => {
    tempPluginsDir = await writePluginPackage({
      web: true,
      serverSource: [
        'export function activate() {',
        '  throw new Error("disabled plugin should not activate")',
        '}',
      ].join('\n'),
    })
    setPluginActivationPolicy('@cradle/loader-cleanup', { enabled: false, reason: 'test disabled' })
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'workspaceDev'

    const app = new Elysia()
    await activateServerPlugins(app)

    const descriptor = listPluginDescriptors().find(plugin => plugin.identity === '@cradle/loader-cleanup')
    expect(descriptor?.activation).toMatchObject({
      enabled: false,
      source: 'user',
      reason: 'test disabled',
    })
    expect(descriptor?.layers.server.status).toBe('disabled')
    expect(descriptor?.layers.web.status).toBe('disabled')
    expect(getRegisteredMcpServers()).not.toHaveProperty('loader-cleanup')

    const response = await app.handle(new Request('http://localhost/api/plugins/loader-cleanup/web.mjs'))
    expect(response.status).toBe(404)
  })

  it('rejects legacy manifest declaration arrays during discovery', async () => {
    tempPluginsDir = await writeUnsupportedManifestPackage()
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'workspaceDev'

    await activateServerPlugins(new Elysia())

    const descriptor = listPluginDescriptors().find(plugin => plugin.identity === 'invalid:unsupported-plugin')
    expect(descriptor?.layers.server.status).toBe('invalid')
    expect(descriptor?.warnings.join('\n')).toContain(
      'cradle.capabilities is not supported in apiVersion 1; use cradle.contributes.capabilities.',
    )
    expect(descriptor?.warnings.join('\n')).toContain(
      'cradle.permissions is not supported in apiVersion 1; use cradle.contributes.permissions.',
    )
  })

  it('rejects apiVersion 1 manifests without explicit contributes', async () => {
    tempPluginsDir = await writePluginPackage({ omitContributes: true })
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'workspaceDev'

    await activateServerPlugins(new Elysia())

    const descriptor = listPluginDescriptors().find(plugin => plugin.identity === 'invalid:cleanup-plugin')
    expect(descriptor?.layers.server.status).toBe('invalid')
    expect(descriptor?.warnings.join('\n')).toContain('cradle.contributes')
  })

  it('disables external local server plugins when required permissions are not granted', async () => {
    tempPluginsDir = await writePluginPackage({
      contributes: {
        capabilities: [{
          id: 'mcp.loader-cleanup',
          type: 'mcp-server',
          layer: 'server',
          permissions: ['test.permission'],
        }],
        permissions: [{
          id: 'test.permission',
          required: true,
        }],
      },
    })
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'externalLocal'
    await grantLoaderCleanupPluginTrust(tempPluginsDir)

    await activateServerPlugins(new Elysia())

    const descriptor = listPluginDescriptors().find(plugin => plugin.identity === '@cradle/loader-cleanup')
    expect(descriptor?.layers.server.status).toBe('disabled')
    expect(descriptor?.layers.server.error).toContain('Missing required plugin permission grants: test.permission')
    expect(getRegisteredMcpServers()).not.toHaveProperty('loader-cleanup')
  })

  it('does not activate external local server plugins without an operator trust grant', async () => {
    tempPluginsDir = await writePluginPackage()
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'externalLocal'

    await activateServerPlugins(new Elysia())

    const descriptor = listPluginDescriptors().find(plugin => plugin.identity === '@cradle/loader-cleanup')
    expect(descriptor?.source.trusted).toBe(false)
    expect(descriptor?.source.checksum).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(descriptor?.source.reason).toContain('operator trust grant')
    expect(descriptor?.layers.server.status).toBe('disabled')
    expect(getRegisteredMcpServers()).not.toHaveProperty('loader-cleanup')
  })

  it('activates external local server plugins when required permissions are granted', async () => {
    tempPluginsDir = await writePluginPackage({
      contributes: {
        capabilities: [{
          id: 'mcp.loader-cleanup',
          type: 'mcp-server',
          layer: 'server',
          permissions: ['test.permission'],
        }],
        permissions: [{
          id: 'test.permission',
          required: true,
        }],
      },
    })
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'externalLocal'
    process.env.CRADLE_PLUGIN_ALLOWED_LOADER_CLEANUP_PERMISSIONS = 'test.permission'
    await grantLoaderCleanupPluginTrust(tempPluginsDir)

    await activateServerPlugins(new Elysia())

    const descriptor = listPluginDescriptors().find(plugin => plugin.identity === '@cradle/loader-cleanup')
    expect(descriptor?.layers.server.status).toBe('active')
    expect(getRegisteredMcpServers()).toHaveProperty('loader-cleanup')
  })

  it('records an operator trust grant when enabling an external local plugin', async () => {
    tempPluginsDir = await writePluginPackage()
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'externalLocal'

    await activateServerPlugins(new Elysia())

    const discovered = listPluginDescriptors().find(plugin => plugin.identity === '@cradle/loader-cleanup')
    expect(discovered?.layers.server.status).toBe('disabled')

    const enabled = await enablePlugin('@cradle/loader-cleanup')

    expect(enabled.source.trusted).toBe(true)
    expect(enabled.layers.server.status).toBe('active')
    expect(getRegisteredMcpServers()).toHaveProperty('loader-cleanup')
  })

  it('blocks external local plugins while relay host enrollments expose the server', async () => {
    tempPluginsDir = await writePluginPackage()
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'externalLocal'
    await grantLoaderCleanupPluginTrust(tempPluginsDir)
    db().insert(relayHostEnrollments).values({
      id: 'plugin-loader-relay-fixture',
      displayName: 'Plugin Loader Relay Fixture',
      relayUrl: 'https://relay.example.test',
      roomId: 'plugin-loader-relay-room',
      hostPubkey: 'host-pubkey-plugin-loader-relay-fixture',
      hostPrivateKeySecretId: 'relay-host-key:plugin-loader-relay-fixture',
      pinnedControllerPubkey: 'controller-pubkey-plugin-loader-relay-fixture',
      status: 'paired',
      pairingCode: null,
      lastError: null,
    }).run()

    await activateServerPlugins(new Elysia())

    const descriptor = listPluginDescriptors().find(plugin => plugin.identity === '@cradle/loader-cleanup')
    expect(descriptor?.source.trusted).toBe(false)
    expect(descriptor?.source.reason).toContain('relay host enrollments')
    expect(descriptor?.layers.server.status).toBe('disabled')
    expect(getRegisteredMcpServers()).not.toHaveProperty('loader-cleanup')
  })

  it('does not trust Marketplace receipt grants from ordinary external local directories', async () => {
    tempPluginsDir = await writePluginPackage({
      provenance: true,
      grantedPermissions: ['test.permission'],
      contributes: {
        capabilities: [{
          id: 'mcp.loader-cleanup',
          type: 'mcp-server',
          layer: 'server',
          permissions: ['test.permission'],
        }],
        permissions: [{
          id: 'test.permission',
          required: true,
        }],
      },
    })
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'externalLocal'
    await grantLoaderCleanupPluginTrust(tempPluginsDir)

    await activateServerPlugins(new Elysia())

    const descriptor = listPluginDescriptors().find(plugin => plugin.identity === '@cradle/loader-cleanup')
    expect(descriptor?.source.provenance?.grantedPermissions).toEqual(['test.permission'])
    expect(descriptor?.source.grantedPermissions).toBeUndefined()
    expect(descriptor?.layers.server.status).toBe('disabled')
    expect(descriptor?.layers.server.error).toContain('Missing required plugin permission grants: test.permission')
    expect(getRegisteredMcpServers()).not.toHaveProperty('loader-cleanup')
  })

  it('trusts Marketplace receipt grants from the Cradle-owned installed plugin directory', async () => {
    tempPluginsDir = await writePluginPackage({
      provenance: true,
      grantedPermissions: ['test.permission'],
      contributes: {
        capabilities: [{
          id: 'mcp.loader-cleanup',
          type: 'mcp-server',
          layer: 'server',
          permissions: ['test.permission'],
        }],
        permissions: [{
          id: 'test.permission',
          required: true,
        }],
      },
    })
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'externalLocal'
    process.env.CRADLE_MARKETPLACE_PLUGINS_DIR = tempPluginsDir

    await activateServerPlugins(new Elysia())

    const descriptor = listPluginDescriptors().find(plugin => plugin.identity === '@cradle/loader-cleanup')
    expect(descriptor?.source.provenance?.grantedPermissions).toEqual(['test.permission'])
    expect(descriptor?.source.grantedPermissions).toEqual(['test.permission'])
    expect(descriptor?.layers.server.status).toBe('active')
    expect(getRegisteredMcpServers()).toHaveProperty('loader-cleanup')
  })

  it('refuses marketplace packages when a provided checksum does not match', async () => {
    tempPluginsDir = await writePluginPackage({
      provenance: true,
      packageChecksum: `sha256:${'0'.repeat(64)}`,
    })
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'externalLocal'
    process.env.CRADLE_MARKETPLACE_PLUGINS_DIR = tempPluginsDir

    await activateServerPlugins(new Elysia())

    const descriptor = listPluginDescriptors().find(plugin => plugin.identity === 'invalid:cleanup-plugin')
    expect(descriptor?.layers.server.status).toBe('invalid')
    expect(descriptor?.warnings.join('\n')).toContain('marketplace package checksum mismatch')
    expect(getRegisteredMcpServers()).not.toHaveProperty('loader-cleanup')
  })

  it('fails external local server plugins that register undeclared runtime capabilities', async () => {
    tempPluginsDir = await writePluginPackage({
      contributes: {
        capabilities: [],
        permissions: [],
      },
    })
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'externalLocal'
    await grantLoaderCleanupPluginTrust(tempPluginsDir)

    await activateServerPlugins(new Elysia())

    const descriptor = listPluginDescriptors().find(plugin => plugin.identity === '@cradle/loader-cleanup')
    expect(descriptor?.layers.server.status).toBe('failed')
    expect(descriptor?.layers.server.error).toContain(
      'Runtime capability mcp-server:loader-cleanup is not declared',
    )
    expect(descriptor?.capabilities).toHaveLength(0)
    expect(getRegisteredMcpServers()).not.toHaveProperty('loader-cleanup')
  })

  it('fails external local server plugins that register undeclared streamable HTTP MCP capabilities', async () => {
    tempPluginsDir = await writePluginPackage({
      mcpTransport: 'streamable-http',
      contributes: {
        capabilities: [],
        permissions: [],
      },
    })
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'externalLocal'
    await grantLoaderCleanupPluginTrust(tempPluginsDir)

    await activateServerPlugins(new Elysia())

    const descriptor = listPluginDescriptors().find(plugin => plugin.identity === '@cradle/loader-cleanup')
    expect(descriptor?.layers.server.status).toBe('failed')
    expect(descriptor?.layers.server.error).toContain(
      'Runtime capability mcp-server:loader-cleanup is not declared',
    )
    expect(descriptor?.capabilities).toHaveLength(0)
    expect(getRegisteredMcpServers()).not.toHaveProperty('loader-cleanup')
  })

  it('disables external local web bundles when required permissions are not granted', async () => {
    tempPluginsDir = await writePluginPackage({
      server: false,
      web: true,
      contributes: {
        capabilities: [{
          id: 'panel.loader-cleanup',
          type: 'web-panel',
          layer: 'web',
          permissions: ['web.permission'],
        }],
        permissions: [{
          id: 'web.permission',
          required: true,
        }],
      },
    })
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'externalLocal'
    await grantLoaderCleanupPluginTrust(tempPluginsDir)

    const app = new Elysia()
    await activateServerPlugins(app)

    const descriptor = listPluginDescriptors().find(plugin => plugin.identity === '@cradle/loader-cleanup')
    expect(descriptor?.layers.web.status).toBe('disabled')
    expect(descriptor?.layers.web.error).toContain('Missing required plugin permission grants: web.permission')

    const response = await app.handle(new Request('http://localhost/api/plugins/loader-cleanup/web.mjs'))
    expect(response.status).toBe(404)
  })

  it('serves external local web bundles when required permissions are granted', async () => {
    tempPluginsDir = await writePluginPackage({
      server: false,
      web: true,
      webSource: [
        'import { useState } from "react";',
        'import { jsx } from "react/jsx-runtime";',
        'export function activate() { return [useState, jsx] }',
      ].join('\n'),
      contributes: {
        capabilities: [{
          id: 'panel.loader-cleanup',
          type: 'web-panel',
          layer: 'web',
          permissions: ['web.permission'],
        }],
        permissions: [{
          id: 'web.permission',
          required: true,
        }],
      },
    })
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'externalLocal'
    process.env.CRADLE_PLUGIN_ALLOWED_LOADER_CLEANUP_PERMISSIONS = 'web.permission'
    await grantLoaderCleanupPluginTrust(tempPluginsDir)

    const app = new Elysia()
    await activateServerPlugins(app)

    const descriptor = listPluginDescriptors().find(plugin => plugin.identity === '@cradle/loader-cleanup')
    expect(descriptor?.layers.web.status).toBe('discovered')

    const response = await app.handle(new Request('http://localhost/api/plugins/loader-cleanup/web.mjs'))
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(await response.text()).toBe([
      'import { useState } from "http://localhost/api/plugins/-/deps/react.mjs";',
      'import { jsx } from "http://localhost/api/plugins/-/deps/react-jsx-runtime.mjs";',
      'export function activate() { return [useState, jsx] }',
    ].join('\n'))

    const dependencyResponse = await app.handle(new Request('http://localhost/api/plugins/-/deps/react.mjs'))
    expect(dependencyResponse.status).toBe(200)
    expect(dependencyResponse.headers.get('access-control-allow-origin')).toBe('*')
    expect(await dependencyResponse.text()).toContain('window[Symbol.for(\'cradle:modules\')]')
  })

  it('dispatches plugin HTTP routes and removes them on deactivation', async () => {
    tempPluginsDir = await writePluginPackage({
      serverSource: [
        'export function activate(ctx) {',
        '  ctx.routes.register({',
        '    method: "GET",',
        '    path: "/status/:id",',
        '    handler: ({ params, query, headers }) => ({ id: params.id, mode: query.mode, header: headers["x-test"] })',
        '  })',
        '}',
      ].join('\n'),
    })
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'workspaceDev'

    const app = new Elysia()
    await activateServerPlugins(app)

    const activeResponse = await app.handle(new Request('http://localhost/api/plugins/loader-cleanup/status/abc?mode=fast', {
      headers: { 'x-test': 'present' },
    }))
    expect(activeResponse.status).toBe(200)
    expect(await activeResponse.json()).toEqual({ id: 'abc', mode: 'fast', header: 'present' })

    await deactivateAllPlugins()

    const inactiveResponse = await app.handle(new Request('http://localhost/api/plugins/loader-cleanup/status/abc?mode=fast'))
    expect(inactiveResponse.status).toBe(404)
    expect(await inactiveResponse.json()).toEqual({ error: 'Plugin route not found.' })
  })

  it('hot disables and re-enables active plugin runtime registrations', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'cradle-plugin-loader-home-'))
    const builtinRoot = join(homeDir, 'builtin-skills')
    const previousHome = process.env.HOME
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousBuiltinSkillsDir = process.env.CRADLE_BUILTIN_SKILLS_DIR
    process.env.HOME = homeDir
    process.env.CRADLE_DATA_DIR = homeDir
    process.env.CRADLE_BUILTIN_SKILLS_DIR = builtinRoot
    await writeBuiltinSkillPackage(builtinRoot)
    tempPluginsDir = await writePluginPackage({
      serverSource: [
        'import { fileURLToPath } from "node:url"',
        '',
        'export function activate(ctx) {',
        '  ctx.mcp.registerServer({ transport: "stdio", name: "loader-cleanup", command: "node", args: ["server.mjs"] })',
        '  ctx.routes.register({ method: "GET", path: "/status", handler: () => ({ ok: true }) })',
        '  ctx.skills.register({ name: "loader-cleanup-skill", description: "A skill", skillFile: fileURLToPath(new URL("./SKILL.md", import.meta.url)) })',
        '}',
      ].join('\n'),
    })
    try {
      process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
      process.env.CRADLE_PLUGINS_SOURCE_KIND = 'workspaceDev'

      const app = new Elysia()
      await activateServerPlugins(app)

      expect(getRegisteredMcpServers()).toHaveProperty('loader-cleanup')
      expect((await app.handle(new Request('http://localhost/api/plugins/loader-cleanup/status'))).status).toBe(200)

      const runtimeContext = resolveCodexRuntimeContext('/tmp/workspace', 'loader-agent')
      const projectedSkill = join(runtimeContext.agentHome ?? '', 'skills', 'cradle', 'plugin-loader-cleanup-skill', 'SKILL.md')
      expect(existsSync(projectedSkill)).toBe(true)

      await setAppPreferences({
        featureFlags: {
          multiWorkspacePoc: false,
          localAuthForDangerousActions: false,
          continueBlockedCodexGoals: false,
          blockCodexAppServerLogInserts: false,
          nativeProviderSkillProjection: true,
        },
      })
      const globalRuntimeContext = resolveCodexRuntimeContext('/tmp/workspace', null)
      const globalProjectedSkill = join(homeDir, '.codex', 'skills', 'cradle', 'plugin-loader-cleanup-skill', 'SKILL.md')
      const globalBuiltinSkill = join(homeDir, '.codex', 'skills', 'cradle', 'builtin-loader-skill', 'SKILL.md')
      expect(globalRuntimeContext.agentHome).toBeNull()
      expect(existsSync(globalProjectedSkill)).toBe(true)
      expect(existsSync(globalBuiltinSkill)).toBe(true)

      const disabled = await disablePlugin('@cradle/loader-cleanup', 'hot test')
      expect(disabled.activation).toMatchObject({ enabled: false, source: 'user', reason: 'hot test' })
      expect(disabled.layers.server.status).toBe('disabled')
      expect(disabled.capabilities).toHaveLength(0)
      expect(getRegisteredMcpServers()).not.toHaveProperty('loader-cleanup')
      expect((await app.handle(new Request('http://localhost/api/plugins/loader-cleanup/status'))).status).toBe(404)
      expect(existsSync(projectedSkill)).toBe(false)
      expect(existsSync(globalProjectedSkill)).toBe(false)
      expect(existsSync(globalBuiltinSkill)).toBe(true)

      const enabled = await enablePlugin('@cradle/loader-cleanup')
      expect(enabled.activation).toMatchObject({ enabled: true, source: 'user' })
      expect(enabled.layers.server.status).toBe('active')
      expect(enabled.capabilities.map(capability => capability.type).sort()).toEqual(['mcp-server', 'server-route', 'skill'])
      expect(getRegisteredMcpServers()).toHaveProperty('loader-cleanup')
      expect((await app.handle(new Request('http://localhost/api/plugins/loader-cleanup/status'))).status).toBe(200)
      expect(existsSync(projectedSkill)).toBe(true)
      expect(existsSync(globalProjectedSkill)).toBe(true)
      expect(existsSync(globalBuiltinSkill)).toBe(true)
    }
    finally {
      resetNativeSkillProjectionTargets()
      if (previousHome === undefined) {
        delete process.env.HOME
      }
      else {
        process.env.HOME = previousHome
      }
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousBuiltinSkillsDir === undefined) {
        delete process.env.CRADLE_BUILTIN_SKILLS_DIR
      }
      else {
        process.env.CRADLE_BUILTIN_SKILLS_DIR = previousBuiltinSkillsDir
      }
      await rm(homeDir, { recursive: true, force: true })
    }
  })

  it('marks plugins with missing web bundles as failed before listing descriptors', async () => {
    tempPluginsDir = await writePluginPackage({
      server: false,
      web: true,
      writeWebEntry: false,
      contributes: {
        capabilities: [{
          id: 'panel.loader-cleanup',
          type: 'web-panel',
          layer: 'web',
          permissions: [],
        }],
        permissions: [],
      },
    })
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'workspaceDev'

    const app = new Elysia()
    await activateServerPlugins(app)

    const listResponse = await app.handle(new Request('http://localhost/api/plugins/'))
    expect(listResponse.status).toBe(200)
    const plugins = await listResponse.json() as Array<{ identity: string, layers: { web: { status: string, error?: string } } }>
    const descriptor = plugins.find(plugin => plugin.identity === '@cradle/loader-cleanup')
    expect(descriptor?.layers.web.status).toBe('failed')
    expect(descriptor?.layers.web.error).toBe('Web entry is missing: web.mjs')

    const webResponse = await app.handle(new Request('http://localhost/api/plugins/loader-cleanup/web.mjs'))
    expect(webResponse.status).toBe(404)
  })

  it('projects Marketplace install receipt provenance into plugin descriptors', async () => {
    tempPluginsDir = await writePluginPackage({ provenance: true })
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'externalLocal'

    await activateServerPlugins(new Elysia())

    const descriptor = listPluginDescriptors().find(plugin => plugin.identity === '@cradle/loader-cleanup')
    expect(descriptor?.source.provenance).toMatchObject({
      kind: 'marketplace-install',
      mode: 'downloaded',
      repository: 'wibus-wee/Cradle',
      path: 'plugins/loader-cleanup',
      packageName: '@cradle/loader-cleanup',
      version: '1.0.0',
      ref: 'main',
    })
  })

  it('discovers a persisted local source without activating it until operator enable', async () => {
    tempPluginsDir = await writePluginPackage({
      packageName: '@acme/live-source',
      contributes: {
        capabilities: [{
          id: 'mcp.live-source',
          type: 'mcp-server',
          layer: 'server',
          permissions: [],
        }],
        permissions: [],
      },
      serverSource: [
        'export function activate(ctx) {',
        '  ctx.mcp.registerServer({ transport: "stdio", name: "live-source", command: "node", args: ["server.mjs"] })',
        '}',
      ].join('\n'),
    })
    db()
      .delete(pluginActivationPolicies)
      .where(eq(pluginActivationPolicies.pluginName, '@acme/live-source'))
      .run()

    const source = addPluginSource({
      kind: 'localPath',
      location: tempPluginsDir,
      addedReason: 'test source',
    })

    const discovered = await discoverAndActivateSource(source.id)

    expect(discovered).toHaveLength(1)
    const descriptor = listPluginDescriptors().find(plugin => plugin.identity === '@acme/live-source')
    expect(descriptor?.source.kind).toBe('externalLocal')
    expect(descriptor?.activation).toMatchObject({
      enabled: false,
      source: 'user',
      reason: 'External plugin source was added. Enable the plugin to trust and activate it.',
    })
    expect(descriptor?.layers.server.status).toBe('disabled')
    expect(getRegisteredMcpServers()).not.toHaveProperty('live-source')

    const enabled = await enablePlugin('@acme/live-source')

    expect(enabled.layers.server.status).toBe('active')
    expect(enabled.source.trusted).toBe(true)
    expect(getRegisteredMcpServers()).toHaveProperty('live-source')

    await removeDiscoveredSource(source.id)
    deletePluginSource(source.id)

    expect(listPluginDescriptors().some(plugin => plugin.identity === '@acme/live-source')).toBe(false)
    expect(getRegisteredMcpServers()).not.toHaveProperty('live-source')
  })
})
