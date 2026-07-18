import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const developerGuidePath = 'packages/plugin-sdk/DEVELOPERS.md'

describe('plugin developer docs boundary', () => {
  it('documents server hooks under the chat namespace', async () => {
    const source = await readFile(resolve(repoRoot, developerGuidePath), 'utf8')

    expect(source).toContain('interface ServerPluginHooks {\n  chat: ServerPluginChatHooks\n}')
    expect(source).toContain('interface ServerPluginChatHooks {')
    expect(source).not.toContain('interface ServerPluginHooks {\n  onBeforeQuery')
  })

  it('documents the web route client on WebPluginContext', async () => {
    const source = await readFile(resolve(repoRoot, developerGuidePath), 'utf8')

    expect(source).toContain('interface WebPluginContext {\n  routes: WebPluginRouteClient')
    expect(source).toContain('interface WebPluginRouteClient {\n  url(path: string): string\n  fetch(path: string, init?: RequestInit): Promise<Response>\n}')
  })

  it('documents strict manifest contributions without optional defaults', async () => {
    const developerGuide = await readFile(resolve(repoRoot, developerGuidePath), 'utf8')

    expect(developerGuide).toContain('contributes: {')
    expect(developerGuide).toContain('capabilities: Array<{')
    expect(developerGuide).toContain('permissions: string[]')
    expect(developerGuide).toContain('permissions: Array<{')
    expect(developerGuide).not.toContain('contributes?:')
    expect(developerGuide).not.toContain('capabilities?: Array<{')
    expect(developerGuide).not.toContain('permissions?: Array<{')
    expect(developerGuide).not.toContain('permissions?: string[]')
  })

  it('keeps developer package examples valid under the strict manifest schema', async () => {
    const source = await readFile(resolve(repoRoot, developerGuidePath), 'utf8')
    const { parseCradlePluginPackageJsonText } = await import('@cradle/plugin-sdk/manifest')
    const examplePattern = /\*\*`plugins\/[^`]+\/package\.json`\*\*\n\n```json\n([\s\S]*?)\n```/g
    const examples = [...source.matchAll(examplePattern)]

    expect(examples.length).toBeGreaterThan(0)
    for (const [, json] of examples) {
      const pkg = parseCradlePluginPackageJsonText(json)
      expect(pkg.cradle.contributes.capabilities).toBeInstanceOf(Array)
      expect(pkg.cradle.contributes.permissions).toBeInstanceOf(Array)
      for (const capability of pkg.cradle.contributes.capabilities) {
        expect(capability.permissions, `${pkg.name}:${capability.id}`).toBeInstanceOf(Array)
      }
    }
  })
})
