import { Elysia } from 'elysia'
import { describe, expect, it, vi } from 'vitest'

import { createOpencodeManagedResourceAdapter } from '../src/modules/chat-runtime-providers/opencode/managed-resource-adapter'
import { createManagedResourcesModule } from '../src/modules/managed-resources'
import type { ManagedResourceAdapter } from '../src/modules/managed-resources/service'
import { ManagedResourceService } from '../src/modules/managed-resources/service'
import { opencodeServer } from '../src/modules/opencode-server'

function fixtureAdapter(): ManagedResourceAdapter {
  return {
    namespace: 'fixture',
    declarations: () => [{
      key: { namespace: 'fixture', resourceType: 'model', resourceId: 'alpha' },
      displayName: 'Fixture model',
      description: 'A declared fixture.',
      kind: 'model',
      required: false,
    }],
    project: vi.fn(async () => ({
      state: 'not-installed',
      installationSource: null,
      installedVersion: null,
      availableVersion: '1.0.0',
      installedSizeBytes: 0,
      downloadSizeBytes: 10,
      actions: {
        install: { available: true, reasonCode: null },
        update: { available: false, reasonCode: 'managed_resource_update_unavailable' },
        uninstall: { available: false, reasonCode: 'managed_resource_not_installed' },
      },
    })),
    execute: vi.fn(async () => ({
      state: 'installed',
      installationSource: 'managed',
      installedVersion: '1.0.0',
      availableVersion: '1.0.0',
      installedSizeBytes: 10,
      downloadSizeBytes: 10,
      actions: {
        install: { available: false, reasonCode: 'managed_resource_already_installed' },
        update: { available: false, reasonCode: 'managed_resource_update_unavailable' },
        uninstall: { available: true, reasonCode: null },
      },
    })),
  }
}

describe('managed resources HTTP contract', () => {
  it('lists pre-download declarations and dispatches commands without installation inputs', async () => {
    const owner = fixtureAdapter()
    const app = new Elysia().use(createManagedResourcesModule(new ManagedResourceService([owner])))
    const listResponse = await app.handle(new Request('http://localhost/managed-resources'))
    expect(listResponse.status).toBe(200)
    const listed = await listResponse.json()
    expect(listed).toEqual([expect.objectContaining({
      key: { namespace: 'fixture', resourceType: 'model', resourceId: 'alpha' },
      state: 'not-installed',
    })])
    expect(JSON.stringify(listed)).not.toMatch(/url|checksum|path|header/i)

    const installResponse = await app.handle(new Request(
      'http://localhost/managed-resources/fixture/model/alpha/install',
      { method: 'POST' },
    ))
    expect(installResponse.status).toBe(200)
    await expect(installResponse.json()).resolves.toMatchObject({ state: 'installed' })
    expect(owner.execute).toHaveBeenCalledWith(
      { namespace: 'fixture', resourceType: 'model', resourceId: 'alpha' },
      'install',
    )

    const bodyResponse = await app.handle(new Request(
      'http://localhost/managed-resources/fixture/model/alpha/install',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: 'caller-controlled' }),
      },
    ))
    expect(bodyResponse.status).toBe(400)
  })

  it('declares the optional OpenCode CLI while preserving process diagnostics', async () => {
    const runtimeStatus = {
      state: 'missing' as const,
      source: null,
      version: null,
      targetVersion: '1.17.11',
      managedInstalled: false,
      installedSizeBytes: null,
      downloadSizeBytes: 42,
      errorCode: 'opencode_runtime_not_installed',
    }
    const installation = {
      status: vi.fn(async () => runtimeStatus),
      install: vi.fn(async () => ({
        ...runtimeStatus,
        state: 'ready' as const,
        source: 'managed' as const,
        version: '1.17.11',
        managedInstalled: true,
      })),
      uninstall: vi.fn(async () => runtimeStatus),
    }
    const app = new Elysia()
      .use(createManagedResourcesModule(new ManagedResourceService([
        createOpencodeManagedResourceAdapter(installation),
      ])))
      .use(opencodeServer)

    const listResponse = await app.handle(new Request('http://localhost/managed-resources'))
    await expect(listResponse.json()).resolves.toEqual([expect.objectContaining({
      key: { namespace: 'opencode', resourceType: 'runtime', resourceId: 'cli' },
      required: false,
      state: 'not-installed',
    })])
    const installResponse = await app.handle(new Request(
      'http://localhost/managed-resources/opencode/runtime/cli/install',
      { method: 'POST' },
    ))
    expect(installResponse.status).toBe(200)
    expect(JSON.stringify(await installResponse.json())).not.toMatch(/url|checksum|header|executablePath|staging/i)
    expect(installation.install).toHaveBeenCalledOnce()

    const diagnosticResponse = await app.handle(new Request('http://localhost/opencode/server/resources'))
    expect(diagnosticResponse.status).toBe(200)
    await expect(diagnosticResponse.json()).resolves.toEqual([])
  })
})
