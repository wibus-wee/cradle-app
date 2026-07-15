/* Parses and installs Cradle Marketplace plugin links for the desktop runtime. */
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

import type { DownloadedArtifact, DownloadRequest } from '@cradle/download-center'
import type { CradlePluginMeta, PluginDeclaredCapabilityRecord, PluginDeclaredPermissionRecord } from '@cradle/plugin-sdk'
import {
  projectCradlePluginContributions,
} from '@cradle/plugin-sdk'
import type { ParsedCradlePluginPackage } from '@cradle/plugin-sdk/manifest'
import { parseCradlePluginPackageJsonText } from '@cradle/plugin-sdk/manifest'
import * as tar from 'tar'

const PLUGIN_INSTALL_PROTOCOL = 'cradle:'
const PLUGIN_INSTALL_HOST = 'plugins'
const PLUGIN_INSTALL_PATH = '/install'
const INSTALLED_PLUGINS_DIR = 'marketplace/plugins'
const TEMP_INSTALL_DIR = 'marketplace/tmp'
const INSTALL_RECEIPTS_DIR = 'marketplace/receipts'
const INSTALL_RECEIPT_FILE = 'cradle-marketplace-install.json'
const SUPPORTED_PARAMS = new Set([
  'source',
  'repository',
  'path',
  'package',
  'version',
  'channel',
  'ref',
])
const REQUIRED_PARAMS = ['source', 'repository', 'path', 'package', 'version', 'channel'] as const
const DEFAULT_GITHUB_REF = 'main'
const MAX_PLUGIN_TARBALL_BYTES = 64 * 1024 * 1024

export interface PluginInstallRequest {
  source: 'github'
  repository: string
  path: string
  packageName: string
  version: string
  channel: 'bundled'
  ref: string
  originalUrl: string
}

export type PluginInstallMode = 'alreadyAvailable' | 'downloaded'

export interface PluginInstallSummary {
  request: PluginInstallRequest
  mode: PluginInstallMode
  packageDir: string
  packageName: string
  version: string
  displayName?: string
  description?: string
  declaredCapabilities: PluginDeclaredCapabilityRecord[]
  declaredPermissions: PluginDeclaredPermissionRecord[]
  requiredPermissions: string[]
}

export interface PluginInstallResult {
  request: PluginInstallRequest
  summary: PluginInstallSummary
  installedAt: string
  mode: PluginInstallMode
  packageDir: string
  receiptPath: string
}

export interface PluginInstallOptions {
  availablePluginsDir?: string
  now?: () => Date
  confirmInstall?: (summary: PluginInstallSummary) => Promise<boolean>
  downloadCenter: {
    execute: (request: DownloadRequest) => Promise<DownloadedArtifact>
    release: (taskId: string) => Promise<unknown>
  }
  userDataPath: string
}

export class PluginInstallLinkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PluginInstallLinkError'
  }
}

const RunnablePluginEntryPattern = /\.(?:mjs|js|cjs)$/

function readSingleParam(url: URL, key: string): string {
  const values = url.searchParams.getAll(key)
  if (values.length === 0) {
    throw new PluginInstallLinkError(`Missing required '${key}' parameter`)
  }
  if (values.length > 1) {
    throw new PluginInstallLinkError(`Duplicate '${key}' parameter`)
  }
  return values[0]?.trim() ?? ''
}

function rejectUnsupportedParams(url: URL): void {
  for (const key of url.searchParams.keys()) {
    if (!SUPPORTED_PARAMS.has(key)) {
      throw new PluginInstallLinkError(`Unsupported '${key}' parameter`)
    }
    if (url.searchParams.getAll(key).length > 1) {
      throw new PluginInstallLinkError(`Duplicate '${key}' parameter`)
    }
  }
}

function validateGitHubRepository(repository: string): void {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    throw new PluginInstallLinkError('GitHub repository must use owner/name syntax')
  }
}

function validatePluginPath(path: string): void {
  if (path === '' || path === '.') {
    return
  }
  if (path.includes('\\') || path.startsWith('/') || path.endsWith('/')) {
    throw new PluginInstallLinkError('Plugin path must be a normalized relative path')
  }
  const segments = path.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new PluginInstallLinkError('Plugin path must not contain empty or traversal segments')
  }
}

function validatePluginPackageName(packageName: string): void {
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(packageName)) {
    throw new PluginInstallLinkError('Plugin package must be a valid npm package name')
  }
}

function validatePluginVersion(version: string): void {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Z.-]+)?$/i.test(version)) {
    throw new PluginInstallLinkError('Plugin version must be a semantic version')
  }
}

function validateGitHubRef(ref: string): void {
  if (!/^[\w./-]+$/.test(ref)) {
    throw new PluginInstallLinkError('GitHub ref contains unsupported characters')
  }
  const segments = ref.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new PluginInstallLinkError('GitHub ref must not contain empty or traversal segments')
  }
}

export function parsePluginInstallUrl(rawUrl: string): PluginInstallRequest {
  let url: URL
  try {
    url = new URL(rawUrl)
  }
 catch {
    throw new PluginInstallLinkError('Plugin install link is not a valid URL')
  }

  if (url.protocol !== PLUGIN_INSTALL_PROTOCOL) {
    throw new PluginInstallLinkError(`Unsupported protocol: ${url.protocol}`)
  }
  if (url.hostname !== PLUGIN_INSTALL_HOST || url.pathname !== PLUGIN_INSTALL_PATH) {
    throw new PluginInstallLinkError('Plugin install link must target cradle://plugins/install')
  }

  rejectUnsupportedParams(url)
  for (const key of REQUIRED_PARAMS) {
    readSingleParam(url, key)
  }

  const source = readSingleParam(url, 'source')
  if (source !== 'github') {
    throw new PluginInstallLinkError(`Unsupported plugin source: ${source}`)
  }
  const channel = readSingleParam(url, 'channel')
  if (channel !== 'bundled') {
    throw new PluginInstallLinkError(`Unsupported plugin channel: ${channel}`)
  }

  const repository = readSingleParam(url, 'repository')
  const path = readSingleParam(url, 'path')
  const packageName = readSingleParam(url, 'package')
  const version = readSingleParam(url, 'version')
  const ref = url.searchParams.get('ref')?.trim() || DEFAULT_GITHUB_REF

  validateGitHubRepository(repository)
  validatePluginPath(path)
  validatePluginPackageName(packageName)
  validatePluginVersion(version)
  validateGitHubRef(ref)

  return {
    source,
    repository,
    path,
    packageName,
    version,
    channel,
    ref,
    originalUrl: rawUrl,
  }
}

export function collectPluginInstallUrls(values: readonly string[]): string[] {
  return values.filter(value => value.startsWith('cradle://plugins/install'))
}

export function resolveDesktopInstalledPluginsDir(userDataPath: string): string {
  return resolve(userDataPath, INSTALLED_PLUGINS_DIR)
}

export function createInstalledPluginPackageDirName(packageName: string): string {
  return packageName
    .replace(/^@/, '')
    .replace(/\//g, '-')
    .replace(/[^\w.-]/g, '-')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  }
 catch {
    return false
  }
}

function resolveAvailablePluginPackageDir(request: PluginInstallRequest, availablePluginsDir: string): string {
  const packageDir = resolve(availablePluginsDir, basename(request.path))
  const root = resolve(availablePluginsDir)
  if (!packageDir.startsWith(`${root}/`) && packageDir !== root) {
    throw new Error(`Available plugin path escapes plugin root: ${request.path}`)
  }
  return packageDir
}

function createGitHubTarballUrl(request: PluginInstallRequest): string {
  const [owner, repo] = request.repository.split('/')
  return `https://api.github.com/repos/${owner}/${repo}/tarball/${encodeURIComponent(request.ref)}`
}

async function downloadPluginArchive(
  request: PluginInstallRequest,
  fileName: string,
  options: PluginInstallOptions,
): Promise<{ archivePath: string, taskId: string }> {
  const artifact = await options.downloadCenter.execute({
    owner: {
      namespace: 'marketplace',
      resourceType: 'plugin-tarball',
      resourceId: `${request.repository}@${request.ref}:${request.path}`,
      displayName: request.packageName,
    },
    fileName,
    sources: [{
      id: 'github-tarball',
      url: createGitHubTarballUrl(request),
      headers: {
        'accept': 'application/vnd.github+json',
        'user-agent': 'Cradle-Desktop-Plugin-Installer',
      },
    }],
    maxBytes: MAX_PLUGIN_TARBALL_BYTES,
  })
  return { archivePath: artifact.filePath, taskId: artifact.taskId }
}

async function extractPluginPath(archivePath: string, request: PluginInstallRequest, stagingDir: string): Promise<void> {
  const requestedPath = request.path
  const isRepositoryRoot = requestedPath === '' || requestedPath === '.'
  const stripSegments = isRepositoryRoot ? 1 : requestedPath.split('/').length + 1
  let matched = false

  await tar.x({
    file: archivePath,
    cwd: stagingDir,
    strip: stripSegments,
    filter(entryPath) {
      const normalized = entryPath.replace(/\\/g, '/')
      const slashIndex = normalized.indexOf('/')
      if (slashIndex < 0) { return false }
      const relativePath = normalized.slice(slashIndex + 1).replace(/\/$/, '')
      if (isRepositoryRoot) {
        matched = true
        return true
      }
      const include = relativePath === requestedPath || relativePath.startsWith(`${requestedPath}/`)
      matched ||= include
      return include
    },
  })

  if (!matched) {
    throw new Error(`Plugin path ${request.path} was not found in ${request.repository}@${request.ref}`)
  }
}

async function validateExtractedPlugin(
  request: PluginInstallRequest,
  packageDir: string,
  options: { requireRunnableEntries: boolean },
): Promise<ParsedCradlePluginPackage> {
  const packageJsonPath = resolve(packageDir, 'package.json')
  const raw = await readFile(packageJsonPath, 'utf8')
  const pkg = parseCradlePluginPackageJsonText(raw)
  if (pkg.name !== request.packageName) {
    throw new Error(`Installed package name mismatch: expected ${request.packageName}, got ${pkg.name}`)
  }
  if (pkg.version !== request.version) {
    throw new Error(`Installed package version mismatch: expected ${request.version}, got ${pkg.version}`)
  }
  if (options.requireRunnableEntries) {
    await validatePluginRuntimeEntries(request, packageDir, pkg.cradle)
  }
  return pkg
}

async function validatePluginRuntimeEntries(
  request: PluginInstallRequest,
  packageDir: string,
  cradle: CradlePluginMeta,
): Promise<void> {
  const entries = [
    ['server', cradle.server],
    ['web', cradle.web],
    ['desktop', cradle.desktop],
  ] as const

  for (const [layer, entry] of entries) {
    if (entry === undefined) { continue }
    if (!RunnablePluginEntryPattern.test(entry)) {
      throw new Error(`Installed package ${request.packageName} declares non-runnable ${layer} entry: ${entry}`)
    }
    if (!await pathExists(resolve(packageDir, entry))) {
      throw new Error(`Installed package ${request.packageName} is missing ${layer} entry: ${entry}`)
    }
  }
}

async function writePluginInstallReceipt(
  request: PluginInstallRequest,
  receiptPath: string,
  installedAt: string,
  mode: PluginInstallMode,
  packageDir: string,
  grantedPermissions: readonly string[],
): Promise<void> {
  await mkdir(dirname(receiptPath), { recursive: true })
  await writeFile(
    receiptPath,
    `${JSON.stringify({
      schemaVersion: 1,
      installedAt,
      mode,
      source: request.source,
      repository: request.repository,
      path: request.path,
      packageName: request.packageName,
      version: request.version,
      channel: request.channel,
      ref: request.ref,
      packageDir,
      originalUrl: request.originalUrl,
      grantedPermissions: [...grantedPermissions],
    }, null, 2)}\n`,
    'utf8',
  )
}

async function publishPluginInstall(stagingDir: string, packageDir: string): Promise<void> {
  const backupDir = `${packageDir}.previous-${Date.now()}`
  await rm(backupDir, { recursive: true, force: true })
  try {
    await rename(packageDir, backupDir)
  }
 catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err
    }
  }

  try {
    await rename(stagingDir, packageDir)
    await rm(backupDir, { recursive: true, force: true })
  }
 catch (err) {
    await rm(packageDir, { recursive: true, force: true })
    try {
      await rename(backupDir, packageDir)
    }
 catch {
      // The previous install may not have existed.
    }
    throw err
  }
}

function createPluginInstallSummary(
  request: PluginInstallRequest,
  packageDir: string,
  mode: PluginInstallMode,
  pkg: ParsedCradlePluginPackage,
): PluginInstallSummary {
  const contributions = projectCradlePluginContributions(pkg.name, pkg.cradle)
  const requiredPermissions = new Set<string>()

  for (const permission of contributions.declaredPermissions) {
    if (permission.required === true) {
      requiredPermissions.add(permission.localId)
    }
  }
  for (const capability of contributions.declaredCapabilities) {
    for (const permission of capability.permissions) {
      requiredPermissions.add(permission)
    }
  }

  return {
    request,
    mode,
    packageDir,
    packageName: pkg.name,
    version: pkg.version,
    displayName: pkg.cradle.displayName,
    description: pkg.cradle.description,
    declaredCapabilities: contributions.declaredCapabilities,
    declaredPermissions: contributions.declaredPermissions,
    requiredPermissions: [...requiredPermissions].sort(),
  }
}

async function acceptPluginInstall(
  summary: PluginInstallSummary,
  options: PluginInstallOptions,
): Promise<boolean> {
  return options.confirmInstall ? options.confirmInstall(summary) : true
}

export async function installPluginFromRequest(
  request: PluginInstallRequest,
  options: PluginInstallOptions,
): Promise<PluginInstallResult | undefined> {
  const now = options.now?.() ?? new Date()
  const installedAt = now.toISOString()
  const receiptName = `${createInstalledPluginPackageDirName(request.packageName)}.json`
  const availableReceiptPath = resolve(options.userDataPath, INSTALL_RECEIPTS_DIR, receiptName)

  if (options.availablePluginsDir) {
    const availablePackageDir = resolveAvailablePluginPackageDir(request, options.availablePluginsDir)
    if (await pathExists(resolve(availablePackageDir, 'package.json'))) {
      const pkg = await validateExtractedPlugin(request, availablePackageDir, { requireRunnableEntries: false })
      const summary = createPluginInstallSummary(request, availablePackageDir, 'alreadyAvailable', pkg)
      if (!await acceptPluginInstall(summary, options)) {
        return undefined
      }
      await writePluginInstallReceipt(
        request,
        availableReceiptPath,
        installedAt,
        'alreadyAvailable',
        availablePackageDir,
        summary.requiredPermissions,
      )
      return {
        request,
        summary,
        installedAt,
        mode: 'alreadyAvailable',
        packageDir: availablePackageDir,
        receiptPath: availableReceiptPath,
      }
    }
  }

  const installRoot = resolveDesktopInstalledPluginsDir(options.userDataPath)
  const packageDir = resolve(installRoot, createInstalledPluginPackageDirName(request.packageName))
  const tempRoot = resolve(options.userDataPath, TEMP_INSTALL_DIR)
  const installId = `${process.pid}-${now.getTime()}-${basename(packageDir)}`
  const stagingDir = resolve(tempRoot, `${installId}.staging`)
  const archiveFileName = `${installId}.tar.gz`
  const receiptPath = resolve(packageDir, INSTALL_RECEIPT_FILE)

  await mkdir(dirname(packageDir), { recursive: true })
  await mkdir(stagingDir, { recursive: true })
  let downloadTaskId: string | null = null

  try {
    const downloaded = await downloadPluginArchive(request, archiveFileName, options)
    downloadTaskId = downloaded.taskId
    await extractPluginPath(downloaded.archivePath, request, stagingDir)
    const pkg = await validateExtractedPlugin(request, stagingDir, { requireRunnableEntries: true })
    const summary = createPluginInstallSummary(request, packageDir, 'downloaded', pkg)
    if (!await acceptPluginInstall(summary, options)) {
      return undefined
    }
    await writePluginInstallReceipt(
      request,
      resolve(stagingDir, INSTALL_RECEIPT_FILE),
      installedAt,
      'downloaded',
      packageDir,
      summary.requiredPermissions,
    )
    await publishPluginInstall(stagingDir, packageDir)
    return {
      request,
      summary,
      installedAt,
      mode: 'downloaded',
      packageDir,
      receiptPath,
    }
  }
  finally {
    if (downloadTaskId) {
      await options.downloadCenter.release(downloadTaskId)
    }
    await rm(stagingDir, { recursive: true, force: true })
  }
}
