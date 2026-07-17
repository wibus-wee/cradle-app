import { randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'

import type {
  PluginDownloadService,
  PluginManagedResourceAdapter,
  PluginManagedResourceProjection,
} from '@cradle/plugin-sdk/server'
import extractZip from 'extract-zip'
import { extract as extractTar, list as listTar } from 'tar'
import { z } from 'zod'

const RELEASES_LATEST_URL = 'https://api.github.com/repos/router-for-me/CLIProxyAPI/releases/latest'
const INSTALLATION_SCHEMA_VERSION = 1
const MAX_RELEASE_METADATA_BYTES = 5 * 1024 * 1024
const MAX_CHECKSUM_MANIFEST_BYTES = 2 * 1024 * 1024
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024

const ReleaseAssetSchema = z.object({
  name: z.string().min(1),
  browser_download_url: z.string().url(),
  size: z.number().int().nonnegative(),
})

const ReleaseSchema = z.object({
  tag_name: z.string().regex(/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/),
  assets: z.array(ReleaseAssetSchema),
})

const InstallationReceiptSchema = z.object({
  schemaVersion: z.literal(INSTALLATION_SCHEMA_VERSION),
  version: z.string().min(1),
  releaseTag: z.string().min(1),
  assetName: z.string().min(1),
  executablePath: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  installedAt: z.string().datetime(),
})

export type InstallationReceipt = z.infer<typeof InstallationReceiptSchema>

interface RuntimeTarget {
  platform: NodeJS.Platform
  arch: string
  assetPattern: RegExp
}

export interface CliProxyRuntimeOptions {
  dataDir: string
  downloads: PluginDownloadService
  platform?: NodeJS.Platform
  arch?: string
}

export interface CliProxyRuntimeStatus {
  installed: boolean
  version: string | null
  executablePath: string | null
  installedSizeBytes: number | null
  supported: boolean
}

function runtimeRoot(dataDir: string): string {
  return path.join(dataDir, 'runtime')
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative.length === 0 || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function validateArchiveEntry(entryPath: string): void {
  const normalized = entryPath.replaceAll('\\', '/')
  if (
    entryPath.includes('\0')
    || path.posix.isAbsolute(normalized)
    || path.win32.isAbsolute(entryPath)
    || normalized.split('/').includes('..')
  ) {
    throw new Error(`CLIProxyAPI archive contains an unsafe path: ${entryPath}`)
  }
}

function resolveRuntimeTarget(platform: NodeJS.Platform, arch: string): RuntimeTarget | null {
  if (platform === 'darwin' && arch === 'arm64') {
    return { platform, arch, assetPattern: /_darwin_arm64\.tar\.gz$/ }
  }
  if (platform === 'darwin' && arch === 'x64') {
    return { platform, arch, assetPattern: /_darwin_amd64\.tar\.gz$/ }
  }
  if (platform === 'linux' && arch === 'arm64') {
    return { platform, arch, assetPattern: /_linux_arm64(?:_no-plugin)?\.tar\.gz$/ }
  }
  if (platform === 'linux' && arch === 'x64') {
    return { platform, arch, assetPattern: /_linux_amd64(?:_no-plugin)?\.tar\.gz$/ }
  }
  if (platform === 'win32' && arch === 'arm64') {
    return { platform, arch, assetPattern: /_windows_arm64(?:_no-plugin)?\.zip$/ }
  }
  if (platform === 'win32' && arch === 'x64') {
    return { platform, arch, assetPattern: /_windows_amd64(?:_no-plugin)?\.zip$/ }
  }
  return null
}

function readReceipt(dataDir: string): InstallationReceipt | null {
  try {
    const root = runtimeRoot(dataDir)
    const receipt = InstallationReceiptSchema.parse(JSON.parse(readFileSync(path.join(root, 'current.json'), 'utf8')))
    const executablePath = path.resolve(root, receipt.executablePath)
    if (!isInside(root, executablePath) || !statSync(executablePath).isFile()) { return null }
    const versionReceipt = InstallationReceiptSchema.parse(JSON.parse(readFileSync(
      path.join(root, 'versions', receipt.version, 'installation.json'),
      'utf8',
    )))
    return JSON.stringify(receipt) === JSON.stringify(versionReceipt) ? receipt : null
  }
  catch {
    return null
  }
}

export function readRuntimeStatus(options: Pick<CliProxyRuntimeOptions, 'dataDir' | 'platform' | 'arch'>): CliProxyRuntimeStatus {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const receipt = readReceipt(options.dataDir)
  if (!receipt) {
    return {
      installed: false,
      version: null,
      executablePath: null,
      installedSizeBytes: null,
      supported: resolveRuntimeTarget(platform, arch) !== null,
    }
  }
  const root = runtimeRoot(options.dataDir)
  const executablePath = path.resolve(root, receipt.executablePath)
  return {
    installed: true,
    version: receipt.version,
    executablePath,
    installedSizeBytes: statSync(executablePath).size,
    supported: true,
  }
}

async function downloadText(
  downloads: PluginDownloadService,
  request: Parameters<PluginDownloadService['execute']>[0],
): Promise<string> {
  const artifact = await downloads.execute(request)
  try {
    return await readFile(artifact.filePath, 'utf8')
  }
  finally {
    await downloads.release(artifact.taskId)
  }
}

function parseChecksum(manifest: string, assetName: string): string {
  for (const line of manifest.split(/\r?\n/)) {
    const match = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i)
    if (match?.[2] === assetName) { return match[1]!.toLowerCase() }
  }
  throw new Error(`CLIProxyAPI checksum manifest does not contain ${assetName}.`)
}

async function verifyExtractedTree(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const candidate = path.join(root, entry.name)
    const info = await lstat(candidate)
    if (info.isSymbolicLink()) {
      throw new Error(`CLIProxyAPI archive contains a symbolic link: ${entry.name}`)
    }
    if (info.isDirectory()) {
      await verifyExtractedTree(candidate)
      continue
    }
    if (!info.isFile()) {
      throw new Error(`CLIProxyAPI archive contains an unsupported entry: ${entry.name}`)
    }
  }
}

async function extractArchive(archivePath: string, assetName: string, destination: string): Promise<void> {
  if (assetName.endsWith('.tar.gz')) {
    await listTar({
      file: archivePath,
      onentry(entry) {
        validateArchiveEntry(entry.path)
        if (!entry.type.startsWith('File') && !entry.type.startsWith('Directory')) {
          throw new Error(`CLIProxyAPI archive contains an unsupported ${entry.type} entry.`)
        }
      },
    })
    await extractTar({ file: archivePath, cwd: destination, preservePaths: false })
  }
  else if (assetName.endsWith('.zip')) {
    await extractZip(archivePath, {
      dir: destination,
      onEntry(entry) {
        validateArchiveEntry(entry.fileName)
      },
    })
  }
  else {
    throw new Error(`Unsupported CLIProxyAPI archive: ${assetName}`)
  }
  await verifyExtractedTree(destination)
}

async function findExecutable(root: string, platform: NodeJS.Platform): Promise<string> {
  const expected = platform === 'win32' ? 'cli-proxy-api.exe' : 'cli-proxy-api'
  const pending = [root]
  while (pending.length > 0) {
    const directory = pending.shift()!
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name)
      if (entry.isDirectory()) { pending.push(candidate) }
      else if (entry.isFile() && entry.name.toLowerCase() === expected) { return candidate }
    }
  }
  throw new Error(`CLIProxyAPI archive does not contain ${expected}.`)
}

export async function installRuntime(options: CliProxyRuntimeOptions): Promise<CliProxyRuntimeStatus> {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const target = resolveRuntimeTarget(platform, arch)
  if (!target) { throw new Error(`CLIProxyAPI does not support ${platform}/${arch}.`) }

  const releaseText = await downloadText(options.downloads, {
    owner: { resourceType: 'runtime', resourceId: 'cli-proxy-api', displayName: 'CLIProxyAPI release metadata' },
    fileName: 'release-latest.json',
    sources: [{
      id: 'github-release-latest',
      url: RELEASES_LATEST_URL,
      headers: {
        'accept': 'application/vnd.github+json',
        'user-agent': 'Cradle-CLIProxyAPI-Plugin',
      },
    }],
    maxBytes: MAX_RELEASE_METADATA_BYTES,
    maxAttempts: 3,
  })
  const release = ReleaseSchema.parse(JSON.parse(releaseText))
  const version = release.tag_name.slice(1)
  const currentStatus = readRuntimeStatus({ dataDir: options.dataDir, platform, arch })
  if (currentStatus.installed && currentStatus.version === version) {
    return currentStatus
  }
  const asset = release.assets.find(candidate => target.assetPattern.test(candidate.name))
  if (!asset) { throw new Error(`CLIProxyAPI ${release.tag_name} has no asset for ${platform}/${arch}.`) }
  const checksumAsset = release.assets.find(candidate => candidate.name === 'checksums.txt')
  if (!checksumAsset) { throw new Error(`CLIProxyAPI ${release.tag_name} does not publish checksums.txt.`) }
  const checksumText = await downloadText(options.downloads, {
    owner: { resourceType: 'runtime', resourceId: 'cli-proxy-api', displayName: 'CLIProxyAPI checksums' },
    fileName: `checksums-${release.tag_name}.txt`,
    sources: [{ id: `github-checksums-${release.tag_name}`, url: checksumAsset.browser_download_url }],
    integrity: { expectedBytes: checksumAsset.size },
    maxBytes: MAX_CHECKSUM_MANIFEST_BYTES,
    maxAttempts: 3,
  })
  const checksum = parseChecksum(checksumText, asset.name)
  const artifact = await options.downloads.execute({
    owner: { resourceType: 'runtime', resourceId: 'cli-proxy-api', displayName: 'CLIProxyAPI runtime' },
    fileName: asset.name,
    sources: [{ id: `github-${release.tag_name}-${asset.name}`, url: asset.browser_download_url }],
    integrity: {
      expectedBytes: asset.size,
      checksum: { algorithm: 'sha256', value: checksum },
    },
    maxBytes: Math.min(MAX_ARCHIVE_BYTES, Math.max(asset.size, 1)),
    maxAttempts: 3,
  })

  const root = runtimeRoot(options.dataDir)
  const stagingRoot = path.join(root, 'staging', randomUUID())
  const versionRoot = path.join(root, 'versions', version)
  try {
    await mkdir(stagingRoot, { recursive: true })
    await extractArchive(artifact.filePath, asset.name, stagingRoot)
    const extractedExecutable = await findExecutable(stagingRoot, platform)
    if (platform !== 'win32') { await chmod(extractedExecutable, 0o755) }
    await rm(versionRoot, { recursive: true, force: true })
    await mkdir(path.dirname(versionRoot), { recursive: true })
    await rename(stagingRoot, versionRoot)
    const installedExecutable = path.join(versionRoot, path.relative(stagingRoot, extractedExecutable))
    const receipt: InstallationReceipt = {
      schemaVersion: INSTALLATION_SCHEMA_VERSION,
      version,
      releaseTag: release.tag_name,
      assetName: asset.name,
      executablePath: path.relative(root, installedExecutable),
      sha256: checksum,
      installedAt: new Date().toISOString(),
    }
    await writeFile(path.join(versionRoot, 'installation.json'), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })
    const currentTemp = path.join(root, `current.${randomUUID()}.json`)
    await writeFile(currentTemp, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })
    await rename(currentTemp, path.join(root, 'current.json'))
    return readRuntimeStatus({ dataDir: options.dataDir, platform, arch })
  }
  finally {
    await rm(stagingRoot, { recursive: true, force: true })
    await options.downloads.release(artifact.taskId)
  }
}

export async function uninstallRuntime(options: Pick<CliProxyRuntimeOptions, 'dataDir' | 'platform' | 'arch'>): Promise<CliProxyRuntimeStatus> {
  await rm(runtimeRoot(options.dataDir), { recursive: true, force: true })
  return readRuntimeStatus(options)
}

function enabled() {
  return { available: true, reasonCode: null }
}

function disabled(reasonCode: string) {
  return { available: false, reasonCode }
}

function project(status: CliProxyRuntimeStatus): PluginManagedResourceProjection {
  return {
    state: status.installed ? 'installed' : status.supported ? 'not-installed' : 'unavailable',
    installationSource: status.installed ? 'managed' : null,
    installedVersion: status.version,
    availableVersion: null,
    installedSizeBytes: status.installedSizeBytes,
    downloadSizeBytes: null,
    actions: {
      install: !status.installed && status.supported ? enabled() : disabled(status.installed ? 'managed_resource_already_installed' : 'cli_proxy_api_platform_unsupported'),
      update: status.installed ? enabled() : disabled('managed_resource_not_installed'),
      uninstall: status.installed ? enabled() : disabled('managed_resource_not_installed'),
    },
  }
}

export function createRuntimeResourceAdapter(options: CliProxyRuntimeOptions): PluginManagedResourceAdapter {
  return {
    declarations: () => [{
      key: { resourceType: 'runtime', resourceId: 'cli-proxy-api' },
      displayName: 'CLIProxyAPI runtime',
      description: 'Optional CLIProxyAPI executable managed by its Cradle plugin.',
      kind: 'runtime',
      required: false,
    }],
    async project() {
      return project(readRuntimeStatus(options))
    },
    async execute(_key, action) {
      if (action === 'uninstall') {
        return project(await uninstallRuntime(options))
      }
      return project(await installRuntime(options))
    },
  }
}
