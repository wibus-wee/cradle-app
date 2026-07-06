/* Verifies Cradle Marketplace plugin install link parsing and install receipts. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import * as tar from 'tar'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { PluginInstallOptions } from './plugin-install-links'
import {
  collectPluginInstallUrls,
  createInstalledPluginPackageDirName,
  installPluginFromRequest,
  parsePluginInstallUrl,
  PluginInstallLinkError,
  resolveDesktopInstalledPluginsDir,
} from './plugin-install-links'

const tempRoots: string[] = []
const installUrl = 'cradle://plugins/install?source=github&repository=wibus-wee%2Fcradle-app&path=plugins%2Fsystem-info&package=%40cradle%2Fsystem-info&version=0.0.1&channel=bundled'
const InstallReceiptJsonSchema = z.string().transform(raw => JSON.parse(raw)).pipe(z.object({
  mode: z.enum(['alreadyAvailable', 'downloaded']),
  packageName: z.string(),
  packageDir: z.string(),
}).passthrough())

const PackageJsonSchema = z.string().transform(raw => JSON.parse(raw)).pipe(z.object({
  name: z.string(),
  version: z.string(),
}).passthrough())

async function createTempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

async function writePluginPackage(
  root: string,
  relativePath: string,
  packageName = '@cradle/system-info',
  serverEntry = 'dist/server.mjs',
): Promise<string> {
  const packageDir = resolve(root, relativePath)
  await mkdir(packageDir, { recursive: true })
  await writeFile(
    resolve(packageDir, 'package.json'),
    `${JSON.stringify({
      name: packageName,
      version: '0.0.1',
      type: 'module',
      cradle: {
        apiVersion: '1',
        displayName: 'System Info',
        server: serverEntry,
        contributes: {
          capabilities: [
            {
              id: 'system-info',
              type: 'mcp-server',
              layer: 'server',
              label: 'System Info MCP',
              permissions: ['system-info.read'],
            },
          ],
          permissions: [
            {
              id: 'system-info.read',
              label: 'Read system info',
              required: true,
            },
          ],
        },
      },
    }, null, 2)}\n`,
    'utf8',
  )
  await mkdir(resolve(packageDir, 'dist'), { recursive: true })
  await writeFile(resolve(packageDir, 'dist/server.mjs'), 'export function activate() {}\n', 'utf8')
  return packageDir
}

async function createRepositoryArchive(): Promise<Buffer> {
  const root = await createTempRoot('cradle-plugin-archive-')
  const repoRoot = resolve(root, 'wibus-wee-cradle-app-testref')
  await writePluginPackage(repoRoot, 'plugins/system-info')
  const archivePath = resolve(root, 'repo.tar.gz')
  await tar.c(
    {
      cwd: root,
      file: archivePath,
      gzip: true,
    },
    ['wibus-wee-cradle-app-testref'],
  )
  return readFile(archivePath)
}

afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

describe('parsePluginInstallUrl', () => {
  it('parses the documented first-party marketplace URL contract', () => {
    expect(parsePluginInstallUrl(installUrl)).toMatchObject({
      source: 'github',
      repository: 'wibus-wee/cradle-app',
      path: 'plugins/system-info',
      packageName: '@cradle/system-info',
      version: '0.0.1',
      channel: 'bundled',
      ref: 'main',
    })
  })

  it('accepts third-party repositories, npm package names, and repository-root paths', () => {
    const thirdPartyUrl = 'cradle://plugins/install?source=github&repository=acme-labs%2Fplugin-pack&path=.&package=acme-plugin&version=1.2.3&channel=bundled'
    expect(parsePluginInstallUrl(thirdPartyUrl)).toMatchObject({
      repository: 'acme-labs/plugin-pack',
      path: '.',
      packageName: 'acme-plugin',
      version: '1.2.3',
    })

    const scopedUrl = 'cradle://plugins/install?source=github&repository=acme%2Fplugin-pack&path=packages%2Ftool&package=%40acme%2Ftool&version=1.2.3&channel=bundled'
    expect(parsePluginInstallUrl(scopedUrl)).toMatchObject({
      repository: 'acme/plugin-pack',
      path: 'packages/tool',
      packageName: '@acme/tool',
    })
  })

  it('rejects duplicate, unknown, malformed, and traversal parameters', () => {
    expect(() => parsePluginInstallUrl(`${installUrl}&package=%40cradle%2Fother`)).toThrow(PluginInstallLinkError)
    expect(() => parsePluginInstallUrl(`${installUrl}&token=secret`)).toThrow(PluginInstallLinkError)
    expect(() => parsePluginInstallUrl(installUrl.replace('wibus-wee%2Fcradle-app', 'missing-repo-owner'))).toThrow(PluginInstallLinkError)
    expect(() => parsePluginInstallUrl(installUrl.replace('version=0.0.1', 'version=latest'))).toThrow(PluginInstallLinkError)
    expect(() => parsePluginInstallUrl(installUrl.replace('%40cradle%2Fsystem-info', '%40bad-scope'))).toThrow(PluginInstallLinkError)
    expect(() => parsePluginInstallUrl(installUrl.replace('plugins%2Fsystem-info', 'plugins%2F..%2Fsystem-info'))).toThrow(PluginInstallLinkError)
  })
})

describe('collectPluginInstallUrls', () => {
  it('collects plugin install URLs from process argv values', () => {
    expect(collectPluginInstallUrls(['--flag', installUrl, 'https://example.com'])).toEqual([installUrl])
  })
})

describe('installPluginFromRequest', () => {
  it('records an install receipt when the bundled plugin is already available', async () => {
    const userDataPath = await createTempRoot('cradle-plugin-user-data-')
    const pluginsRoot = await createTempRoot('cradle-plugin-bundled-')
    const availablePackageDir = await writePluginPackage(pluginsRoot, 'system-info', '@cradle/system-info', 'src/server.ts')
    const fetchImpl = vi.fn<typeof fetch>()

    const result = await installPluginFromRequest(parsePluginInstallUrl(installUrl), {
      availablePluginsDir: pluginsRoot,
      fetchImpl,
      now: () => new Date('2026-05-21T10:00:00.000Z'),
      userDataPath,
    })

    expect(result).toBeDefined()
    if (!result) { throw new Error('Expected plugin install result') }
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      mode: 'alreadyAvailable',
      packageDir: availablePackageDir,
      summary: {
        packageName: '@cradle/system-info',
        requiredPermissions: ['system-info.read'],
      },
    })
    expect(result.summary.declaredCapabilities.map(capability => capability.localId)).toEqual(['system-info'])
    expect(result.summary.declaredPermissions.map(permission => permission.localId)).toEqual(['system-info.read'])
    const receipt = InstallReceiptJsonSchema.parse(await readFile(result.receiptPath, 'utf8'))
    expect(receipt).toMatchObject({
      mode: 'alreadyAvailable',
      packageName: '@cradle/system-info',
      packageDir: availablePackageDir,
      grantedPermissions: ['system-info.read'],
    })
  })

  it('downloads a plugin into the Cradle-owned installed plugin directory when it is not bundled', async () => {
    const userDataPath = await createTempRoot('cradle-plugin-user-data-')
    const archive = await createRepositoryArchive()
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new Uint8Array(archive)))

    const result = await installPluginFromRequest(parsePluginInstallUrl(`${installUrl}&ref=testref`), {
      fetchImpl,
      now: () => new Date('2026-05-21T10:00:00.000Z'),
      userDataPath,
    })

    expect(result).toBeDefined()
    if (!result) { throw new Error('Expected plugin install result') }
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      mode: 'downloaded',
      packageDir: resolve(
        resolveDesktopInstalledPluginsDir(userDataPath),
        createInstalledPluginPackageDirName('@cradle/system-info'),
      ),
    })
    const packageJson = PackageJsonSchema.parse(await readFile(resolve(result.packageDir, 'package.json'), 'utf8'))
    expect(packageJson).toMatchObject({
      name: '@cradle/system-info',
      version: '0.0.1',
    })
    const receipt = InstallReceiptJsonSchema.parse(await readFile(result.receiptPath, 'utf8'))
    expect(receipt).toMatchObject({
      mode: 'downloaded',
      packageName: '@cradle/system-info',
      grantedPermissions: ['system-info.read'],
    })
  })

  it('downloads a plugin from a third-party repository root', async () => {
    const userDataPath = await createTempRoot('cradle-plugin-user-data-')
    const root = await createTempRoot('cradle-plugin-root-archive-')
    const repoRoot = resolve(root, 'acme-plugin-pack-testref')
    await writePluginPackage(repoRoot, '.', '@acme/tool', 'dist/server.mjs')
    const archivePath = resolve(root, 'repo.tar.gz')
    await tar.c(
      {
        cwd: root,
        file: archivePath,
        gzip: true,
      },
      ['acme-plugin-pack-testref'],
    )
    const archive = await readFile(archivePath)
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new Uint8Array(archive)))
    const request = parsePluginInstallUrl('cradle://plugins/install?source=github&repository=acme%2Fplugin-pack&path=.&package=%40acme%2Ftool&version=0.0.1&channel=bundled&ref=testref')

    const result = await installPluginFromRequest(request, {
      fetchImpl,
      now: () => new Date('2026-05-21T10:00:00.000Z'),
      userDataPath,
    })

    expect(result).toBeDefined()
    if (!result) { throw new Error('Expected plugin install result') }
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      mode: 'downloaded',
      packageDir: resolve(
        resolveDesktopInstalledPluginsDir(userDataPath),
        createInstalledPluginPackageDirName('@acme/tool'),
      ),
    })
    const packageJson = PackageJsonSchema.parse(await readFile(resolve(result.packageDir, 'package.json'), 'utf8'))
    expect(packageJson).toMatchObject({
      name: '@acme/tool',
      version: '0.0.1',
    })
  })

  it('does not record a receipt when bundled plugin install consent is denied', async () => {
    const userDataPath = await createTempRoot('cradle-plugin-user-data-')
    const pluginsRoot = await createTempRoot('cradle-plugin-bundled-')
    await writePluginPackage(pluginsRoot, 'system-info', '@cradle/system-info', 'src/server.ts')
    const confirmInstall = vi.fn<NonNullable<PluginInstallOptions['confirmInstall']>>(async () => false)

    const result = await installPluginFromRequest(parsePluginInstallUrl(installUrl), {
      availablePluginsDir: pluginsRoot,
      confirmInstall,
      now: () => new Date('2026-05-21T10:00:00.000Z'),
      userDataPath,
    })

    expect(result).toBeUndefined()
    expect(confirmInstall).toHaveBeenCalledOnce()
    expect(confirmInstall.mock.calls[0]?.[0]).toMatchObject({
      mode: 'alreadyAvailable',
      requiredPermissions: ['system-info.read'],
    })
    await expect(readFile(resolve(userDataPath, 'marketplace/receipts/cradle-system-info.json'), 'utf8')).rejects.toThrow()
  })

  it('does not publish a downloaded plugin when install consent is denied', async () => {
    const userDataPath = await createTempRoot('cradle-plugin-user-data-')
    const archive = await createRepositoryArchive()
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new Uint8Array(archive)))
    const confirmInstall = vi.fn<NonNullable<PluginInstallOptions['confirmInstall']>>(async () => false)
    const packageDir = resolve(
      resolveDesktopInstalledPluginsDir(userDataPath),
      createInstalledPluginPackageDirName('@cradle/system-info'),
    )

    const result = await installPluginFromRequest(parsePluginInstallUrl(`${installUrl}&ref=testref`), {
      confirmInstall,
      fetchImpl,
      now: () => new Date('2026-05-21T10:00:00.000Z'),
      userDataPath,
    })

    expect(result).toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(confirmInstall).toHaveBeenCalledOnce()
    expect(confirmInstall.mock.calls[0]?.[0]).toMatchObject({
      mode: 'downloaded',
      packageDir,
      requiredPermissions: ['system-info.read'],
    })
    await expect(readFile(resolve(packageDir, 'package.json'), 'utf8')).rejects.toThrow()
  })

  it('rejects source-only plugin entries before publishing the install', async () => {
    const userDataPath = await createTempRoot('cradle-plugin-user-data-')
    const root = await createTempRoot('cradle-plugin-source-archive-')
    const repoRoot = resolve(root, 'wibus-wee-cradle-app-source')
    await writePluginPackage(repoRoot, 'plugins/system-info', '@cradle/system-info', 'src/server.ts')
    const archivePath = resolve(root, 'repo.tar.gz')
    await tar.c(
      {
        cwd: root,
        file: archivePath,
        gzip: true,
      },
      ['wibus-wee-cradle-app-source'],
    )
    const archive = await readFile(archivePath)
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new Uint8Array(archive)))

    await expect(installPluginFromRequest(parsePluginInstallUrl(`${installUrl}&ref=source`), {
      fetchImpl,
      userDataPath,
    })).rejects.toThrow('non-runnable server entry')
  })
})
