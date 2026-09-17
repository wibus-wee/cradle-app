import { describe, expect, it, vi } from 'vitest'

import { createOcrModelManagedResourceAdapter } from './managed-resource-adapter'
import type { OcrModelRuntimeStatus } from './model-installation'

const KEY = { namespace: 'image-ocr', resourceType: 'model', resourceId: 'ppocrv6-small' } as const

function statusOf(overrides: Partial<OcrModelRuntimeStatus> = {}): OcrModelRuntimeStatus {
  return {
    state: 'ready',
    source: 'managed',
    version: '0.3.4',
    targetVersion: '0.3.4',
    managedInstalled: true,
    installedSizeBytes: 100,
    downloadSizeBytes: 200,
    errorCode: null,
    ...overrides,
  }
}

function fakeInstallation(status: OcrModelRuntimeStatus) {
  return {
    status: vi.fn(async () => status),
    install: vi.fn(async () => status),
    uninstall: vi.fn(async () => statusOf({ managedInstalled: false, state: 'missing', source: null })),
  }
}

describe('createOcrModelManagedResourceAdapter', () => {
  it('declares the optional OCR model resource', () => {
    const adapter = createOcrModelManagedResourceAdapter(fakeInstallation(statusOf()))
    expect(adapter.namespace).toBe('image-ocr')
    expect(adapter.declarations()).toEqual([{
      key: KEY,
      displayName: 'Light OCR model',
      description: 'PP-OCRv6 Small model bundle managed by Cradle.',
      kind: 'model',
      required: false,
    }])
  })

  it.each([
    ['missing', statusOf({ state: 'missing', source: null, version: null, managedInstalled: false, installedSizeBytes: null, errorCode: 'image_ocr_model_not_installed' }), 'not-installed', null, true, false, false],
    ['bundled external', statusOf({ source: 'bundled', managedInstalled: false }), 'installed', 'external', true, false, false],
    ['configured external', statusOf({ source: 'configured', managedInstalled: false }), 'installed', 'external', false, false, false],
    ['managed update', statusOf({ state: 'update-available', version: '0.3.0' }), 'update-available', 'managed', false, true, true],
    ['installing', statusOf({ state: 'installing', source: null, managedInstalled: false }), 'installing', null, false, false, false],
    ['error', statusOf({ state: 'error', source: null, managedInstalled: false, errorCode: 'image_ocr_model_install_failed' }), 'error', null, true, false, false],
    ['unsupported', statusOf({ state: 'unavailable', source: null, managedInstalled: false, errorCode: 'image_ocr_model_target_unsupported' }), 'unavailable', null, false, false, false],
  ] as const)(
    'projects %s owner truth',
    async (_label, ownerStatus, expectedState, source, install, update, uninstall) => {
      const adapter = createOcrModelManagedResourceAdapter(fakeInstallation(ownerStatus))
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
    const adapter = createOcrModelManagedResourceAdapter(installation)
    await adapter.execute(KEY, 'install')
    expect(installation.install).toHaveBeenCalledTimes(1)
    await adapter.execute(KEY, 'uninstall')
    expect(installation.uninstall).toHaveBeenCalledTimes(1)
  })
})
