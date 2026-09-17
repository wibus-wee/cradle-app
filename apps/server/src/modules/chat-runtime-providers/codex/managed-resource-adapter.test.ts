import { describe, expect, it, vi } from 'vitest'

import { createCodexManagedResourceAdapter } from './managed-resource-adapter'
import type { CodexRuntimeStatus } from './runtime-installation'

const KEY = { namespace: 'codex', resourceType: 'runtime', resourceId: 'app-server' } as const

function status(overrides: Partial<CodexRuntimeStatus> = {}): CodexRuntimeStatus {
  return {
    state: 'missing',
    source: null,
    version: null,
    targetVersion: '0.153.4',
    managedInstalled: false,
    installedSizeBytes: null,
    downloadSizeBytes: 42,
    errorCode: 'codex_runtime_not_installed',
    ...overrides,
  }
}

function installation(projected: CodexRuntimeStatus) {
  return {
    status: vi.fn(async () => projected),
    install: vi.fn(async () => projected),
    uninstall: vi.fn(async () => projected),
  }
}

describe('codex managed resource adapter', () => {
  it.each([
    ['missing', status(), 'not-installed', null, true, false, false],
    ['PATH external', status({ state: 'ready', source: 'path', version: '0.153.4' }), 'installed', 'external', true, false, false],
    ['cli external', status({ state: 'ready', source: 'cli' }), 'installed', 'external', true, false, false],
    ['configured external', status({ state: 'ready', source: 'configured' }), 'installed', 'external', false, false, false],
    ['managed', status({ state: 'ready', source: 'managed', version: '0.153.4', managedInstalled: true }), 'installed', 'managed', false, false, true],
    ['managed update', status({ state: 'update-available', source: 'managed', version: '0.150.0', managedInstalled: true }), 'update-available', 'managed', false, true, true],
    ['installing', status({ state: 'installing' }), 'installing', null, false, false, false],
    ['error', status({ state: 'error', errorCode: 'codex_runtime_probe_failed' }), 'error', null, true, false, false],
    ['unsupported', status({ state: 'unavailable', errorCode: 'codex_runtime_target_unsupported' }), 'unavailable', null, false, false, false],
  ] as const)(
    'projects %s owner truth',
    async (_label, ownerStatus, expectedState, source, install, update, uninstall) => {
      const adapter = createCodexManagedResourceAdapter(installation(ownerStatus))
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

  it('declares a required runtime before download and dispatches only owner lifecycle methods', async () => {
    const owner = installation(status({ state: 'ready', source: 'managed', version: '0.153.4', managedInstalled: true }))
    const adapter = createCodexManagedResourceAdapter(owner)
    expect(adapter.declarations()).toEqual([expect.objectContaining({ key: KEY, required: true, kind: 'runtime' })])

    await adapter.execute(KEY, 'install')
    await adapter.execute(KEY, 'update')
    await adapter.execute(KEY, 'uninstall')
    expect(owner.install).toHaveBeenCalledTimes(2)
    expect(owner.uninstall).toHaveBeenCalledOnce()
  })
})
