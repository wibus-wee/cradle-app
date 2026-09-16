import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  LIGHT_OCR_BUNDLE_PATH_ENV,
  prepareOcrModelManagedPathForRemoval,
  registerOcrEngineLease,
  releaseOcrEngineLease,
  resolveOcrModelBundle,
} from './model-bundle'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'cradle-ocr-model-'))
  tempRoots.push(root)
  return root
}

async function writeManagedBundle(rootDir: string, version = '0.3.4'): Promise<string> {
  const bundleDir = path.join(rootDir, 'versions', version, 'bundle')
  await mkdir(bundleDir, { recursive: true })
  await writeFile(path.join(bundleDir, 'manifest.json'), '{}', 'utf8')
  const manifest = {
    schemaVersion: 1,
    version,
    bundleId: 'ppocrv6-small-native-20260719.1',
    bundlePath: path.join('versions', version, 'bundle'),
    sha512: 'a'.repeat(128),
    installedAt: '2026-09-16T00:00:00.000Z',
  }
  await writeFile(path.join(rootDir, 'versions', version, 'installation.json'), JSON.stringify(manifest), 'utf8')
  await mkdir(rootDir, { recursive: true })
  await writeFile(path.join(rootDir, 'current.json'), JSON.stringify(manifest), 'utf8')
  return bundleDir
}

describe('resolveOcrModelBundle', () => {
  it('prefers the configured override over every other source', async () => {
    const rootDir = tempRoot()
    await writeManagedBundle(rootDir)
    const resolved = resolveOcrModelBundle({
      env: { [LIGHT_OCR_BUNDLE_PATH_ENV]: '/operator/bundle' },
      rootDir,
      bundledPath: '/pkg/bundle',
    })
    expect(resolved).toMatchObject({ source: 'configured', path: '/operator/bundle', managed: false })
  })

  it('resolves the managed bundle before the bundled package', async () => {
    const rootDir = tempRoot()
    const bundleDir = await writeManagedBundle(rootDir, '0.3.4')
    const resolved = resolveOcrModelBundle({ env: {}, rootDir, bundledPath: '/pkg/bundle' })
    expect(resolved).toMatchObject({
      source: 'managed',
      path: bundleDir,
      version: '0.3.4',
      managed: true,
    })
  })

  it('reports bundled without a concrete path so the facade resolves internally', () => {
    const resolved = resolveOcrModelBundle({ env: {}, rootDir: tempRoot(), bundledPath: '/pkg/bundle' })
    expect(resolved).toMatchObject({ source: 'bundled', path: null, managed: false })
  })

  it('returns null when nothing is available', () => {
    expect(resolveOcrModelBundle({ env: {}, rootDir: tempRoot(), bundledPath: null })).toBeNull()
  })
})

describe('ocr engine leases', () => {
  it('closes a leasing engine before allowing removal', async () => {
    const rootDir = tempRoot()
    const bundleDir = await writeManagedBundle(rootDir)
    let closed = false
    registerOcrEngineLease(bundleDir, async () => {
      closed = true
    })
    await expect(prepareOcrModelManagedPathForRemoval(rootDir)).resolves.toBe(true)
    expect(closed).toBe(true)
  })

  it('does not touch engines leasing an unrelated path', async () => {
    const rootDir = tempRoot()
    const otherDir = tempRoot()
    const bundleDir = await writeManagedBundle(rootDir)
    let closed = false
    registerOcrEngineLease(bundleDir, async () => {
      closed = true
    })
    await expect(prepareOcrModelManagedPathForRemoval(otherDir)).resolves.toBe(true)
    expect(closed).toBe(false)
    releaseOcrEngineLease(bundleDir)
  })
})
