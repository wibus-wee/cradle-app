import { describe, expect, it, vi } from 'vitest'

import type {
  ManagedResourceAdapter,
  ManagedResourceProjection,
} from './service'
import { ManagedResourceService } from './service'

const readyProjection: ManagedResourceProjection = {
  state: 'not-installed',
  installationSource: null,
  installedVersion: null,
  availableVersion: '1.0.0',
  installedSizeBytes: 0,
  downloadSizeBytes: 100,
  actions: {
    install: { available: true, reasonCode: null },
    update: { available: false, reasonCode: 'managed_resource_update_unavailable' },
    uninstall: { available: false, reasonCode: 'managed_resource_not_installed' },
  },
}

function adapter(overrides: Partial<ManagedResourceAdapter> = {}): ManagedResourceAdapter {
  return {
    namespace: 'fixture',
    declarations: () => [{
      key: { namespace: 'fixture', resourceType: 'runtime', resourceId: 'one' },
      displayName: 'Fixture runtime',
      description: 'Fixture',
      kind: 'runtime',
      required: false,
    }],
    project: vi.fn(async () => readyProjection),
    execute: vi.fn(async (): Promise<ManagedResourceProjection> => ({
      ...readyProjection,
      state: 'installed',
      installationSource: 'managed',
      installedVersion: '1.0.0',
    })),
    ...overrides,
  }
}

describe('managedResourceService', () => {
  it('lists declarations before installation and dispatches by exact key', async () => {
    const owner = adapter()
    const service = new ManagedResourceService([owner])
    await expect(service.list()).resolves.toMatchObject([{
      key: { namespace: 'fixture', resourceType: 'runtime', resourceId: 'one' },
      state: 'not-installed',
    }])
    await expect(service.execute({ namespace: 'fixture', resourceType: 'runtime', resourceId: 'one' }, 'install'))
      .resolves
.toMatchObject({ state: 'installed', installedVersion: '1.0.0' })
    expect(owner.execute).toHaveBeenCalledWith(
      { namespace: 'fixture', resourceType: 'runtime', resourceId: 'one' },
      'install',
    )
  })

  it('keeps a declaration visible as error when owner projection fails', async () => {
    const service = new ManagedResourceService([adapter({
      project: vi.fn(async () => { throw new Error('private owner failure') }),
    })])
    await expect(service.list()).resolves.toMatchObject([{
      displayName: 'Fixture runtime',
      state: 'error',
      installedVersion: null,
      actions: { install: { available: false, reasonCode: 'managed_resource_projection_failed' } },
    }])
  })

  it('rejects fuzzy keys and disabled commands', async () => {
    const service = new ManagedResourceService([adapter()])
    await expect(service.get({ namespace: 'fixture', resourceType: 'runtime', resourceId: 'ONE' }))
      .rejects
.toMatchObject({ code: 'managed_resource_not_found', status: 404 })
    await expect(service.execute({ namespace: 'fixture', resourceType: 'runtime', resourceId: 'one' }, 'update'))
      .rejects
.toMatchObject({ code: 'managed_resource_update_unavailable', status: 409 })
  })

  it('rejects duplicate namespaces and declaration keys at construction', () => {
    expect(() => new ManagedResourceService([adapter(), adapter()])).toThrow('namespace is already registered')
    expect(() => new ManagedResourceService([adapter({
      declarations: () => [
        ...adapter().declarations(),
        ...adapter().declarations(),
      ],
    })])).toThrow('already declared')
  })

  it('registers and fully removes plugin-owned adapters at runtime', async () => {
    const service = new ManagedResourceService([])
    const owner = adapter({ namespace: 'plugin.cli-proxy-api' })
    owner.declarations = () => [{
      key: { namespace: 'plugin.cli-proxy-api', resourceType: 'runtime', resourceId: 'one' },
      displayName: 'Plugin runtime',
      description: 'Plugin-owned runtime',
      kind: 'runtime',
      required: false,
    }]

    const registration = service.registerAdapter(owner)

    await expect(service.listNamespace('plugin.cli-proxy-api')).resolves.toMatchObject([{
      key: { namespace: 'plugin.cli-proxy-api', resourceType: 'runtime', resourceId: 'one' },
      state: 'not-installed',
    }])

    registration.dispose()

    await expect(service.listNamespace('plugin.cli-proxy-api')).resolves.toEqual([])
    await expect(service.get({
      namespace: 'plugin.cli-proxy-api',
      resourceType: 'runtime',
      resourceId: 'one',
    })).rejects.toMatchObject({ code: 'managed_resource_not_found', status: 404 })
  })
})
