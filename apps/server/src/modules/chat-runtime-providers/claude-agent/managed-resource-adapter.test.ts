import { describe, expect, it, vi } from 'vitest'

import { createClaudeManagedResourceAdapter } from './managed-resource-adapter'
import type { ClaudeCodeRuntimeStatus } from './runtime-installation'

function statusOf(overrides: Partial<ClaudeCodeRuntimeStatus> = {}): ClaudeCodeRuntimeStatus {
  return {
    state: 'ready',
    source: 'managed',
    version: '0.3.261',
    targetVersion: '0.3.261',
    managedInstalled: true,
    installedSizeBytes: 100,
    downloadSizeBytes: 200,
    errorCode: null,
    ...overrides,
  }
}

function fakeInstallation(status: ClaudeCodeRuntimeStatus) {
  return {
    status: vi.fn(async () => status),
    install: vi.fn(async () => status),
    uninstall: vi.fn(async () => statusOf({ managedInstalled: false, state: 'missing', source: null })),
  }
}

describe('createClaudeManagedResourceAdapter', () => {
  it('declares the optional claude runtime resource', () => {
    const adapter = createClaudeManagedResourceAdapter(fakeInstallation(statusOf()))
    expect(adapter.namespace).toBe('claude-agent')
    expect(adapter.declarations()).toEqual([{
      key: { namespace: 'claude-agent', resourceType: 'runtime', resourceId: 'cli' },
      displayName: 'Claude Code runtime',
      description: 'Claude Code runtime managed by Cradle.',
      kind: 'runtime',
      required: false,
    }])
  })

  const KEY = { namespace: 'claude-agent', resourceType: 'runtime', resourceId: 'cli' } as const

  it('projects managed installs as installed with update/uninstall available', async () => {
    const adapter = createClaudeManagedResourceAdapter(fakeInstallation(statusOf()))
    const projection = await adapter.project(KEY)
    expect(projection.state).toBe('installed')
    expect(projection.installationSource).toBe('managed')
    expect(projection.actions.update.available).toBe(false)
    expect(projection.actions.uninstall.available).toBe(true)
  })

  it.each([
    ['missing', statusOf({ state: 'missing', source: null, version: null, managedInstalled: false, installedSizeBytes: null, errorCode: 'claude_agent_runtime_not_installed' }), 'not-installed', null, true, false, false],
    ['sdk-bundled external', statusOf({ source: 'sdk-bundled', managedInstalled: false }), 'installed', 'external', true, false, false],
    ['PATH external', statusOf({ source: 'path', managedInstalled: false }), 'installed', 'external', true, false, false],
    ['configured external', statusOf({ source: 'configured', managedInstalled: false }), 'installed', 'external', false, false, false],
    ['managed update', statusOf({ state: 'update-available', version: '0.3.0' }), 'update-available', 'managed', false, true, true],
    ['installing', statusOf({ state: 'installing', source: null, managedInstalled: false }), 'installing', null, false, false, false],
    ['error', statusOf({ state: 'error', source: null, managedInstalled: false, errorCode: 'claude_agent_runtime_install_failed' }), 'error', null, true, false, false],
    ['unsupported', statusOf({ state: 'unavailable', source: null, managedInstalled: false, errorCode: 'claude_agent_runtime_target_unsupported' }), 'unavailable', null, false, false, false],
  ] as const)(
    'projects %s owner truth',
    async (_label, ownerStatus, expectedState, source, install, update, uninstall) => {
      const adapter = createClaudeManagedResourceAdapter(fakeInstallation(ownerStatus))
      const projection = await adapter.project(KEY)
      expect(projection).toMatchObject({
        state: expectedState,
        installationSource: source,
        actions: {
          install: { available: install },
          update: { available: update },
          uninstall: { available: uninstall },
        },
      })
    },
  )

  it('routes install/uninstall to the installation service', async () => {
    const installation = fakeInstallation(statusOf())
    const adapter = createClaudeManagedResourceAdapter(installation)
    const key = { namespace: 'claude-agent', resourceType: 'runtime', resourceId: 'cli' }
    await adapter.execute(key, 'install')
    expect(installation.install).toHaveBeenCalledTimes(1)
    await adapter.execute(key, 'uninstall')
    expect(installation.uninstall).toHaveBeenCalledTimes(1)
  })
})
