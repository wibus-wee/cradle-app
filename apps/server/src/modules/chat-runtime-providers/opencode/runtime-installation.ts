import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { accessSync, constants, createWriteStream, existsSync, readFileSync, statSync } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'

import type { DownloadedArtifact, DownloadRequest } from '@cradle/download-center'
import { extract as extractTar, list as listTar } from 'tar'
import type { Entry, ZipFile } from 'yauzl'
import { openPromise as openZipPromise } from 'yauzl'

import { AppError } from '../../../errors/app-error'
import { getServerConfig } from '../../../infra'
import type { ProviderHealthStatus } from '../../chat-runtime/runtime-provider-types'
import { toManagedResourceDownloadOwner } from '../../managed-resources/service'
import type { ResolvedOpencodeReleaseTarget } from './runtime-release'
import { OPENCODE_RUNTIME_MANIFEST, resolveOpencodeReleaseTarget } from './runtime-release'

const execFileAsync = promisify(execFile)
const INSTALLATION_SCHEMA_VERSION = 1
const VERSION_PATTERN = /^(?:opencode\s+)?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/
const EXTRACT_TIMEOUT_MS = 60_000

export type OpencodeExecutableSource = 'configured' | 'managed' | 'path'

export interface ResolvedOpencodeExecutable {
  source: OpencodeExecutableSource
  command: string
  version: string | null
  managed: boolean
}

interface OpencodeInstallationManifest {
  schemaVersion: 1
  version: string
  releaseTag: string
  targetKey: string
  executablePath: string
  sha256: string
  installedAt: string
}

export interface OpencodeRuntimeStatus {
  state: 'ready' | 'missing' | 'installing' | 'update-available' | 'error' | 'unavailable'
  source: OpencodeExecutableSource | null
  version: string | null
  targetVersion: string
  managedInstalled: boolean
  installedSizeBytes: number | null
  downloadSizeBytes: number | null
  errorCode: string | null
}

export interface OpencodeRuntimeDownloadCenter {
  execute: (request: DownloadRequest) => Promise<DownloadedArtifact>
  retry: (taskId: string, request: DownloadRequest) => Promise<DownloadedArtifact>
  release: (taskId: string) => Promise<unknown>
  findLatestRetryable: (
    owner: DownloadRequest['owner'],
    sourceId: string,
  ) => { taskId: string, updatedAt: string } | null
}

export interface OpencodeRuntimeInstallationOptions {
  downloadCenter: OpencodeRuntimeDownloadCenter
  rootDir?: string
  env?: NodeJS.ProcessEnv
  target?: ResolvedOpencodeReleaseTarget | null
  probeVersion?: (command: string) => Promise<string>
  extractExecutable?: (
    archivePath: string,
    target: ResolvedOpencodeReleaseTarget,
    destination: string,
  ) => Promise<string>
  prepareManagedPathForRemoval?: (binaryPath: string) => Promise<boolean>
  now?: () => Date
}

export function defaultOpencodeRuntimeRoot(): string {
  const config = getServerConfig()
  return path.join(config.dataDir ?? path.dirname(config.dbPath), 'runtimes', 'opencode')
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative.length === 0 || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function resolveManagedExecutablePath(rootDir: string, relativePath: string): string | null {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('\0')) {
    return null
  }
  const target = path.resolve(rootDir, relativePath)
  return isInside(rootDir, target) ? target : null
}

function readInstallationManifestSync(rootDir: string): OpencodeInstallationManifest | null {
  try {
    const currentPath = path.join(rootDir, 'current.json')
    const manifest: OpencodeInstallationManifest = JSON.parse(readFileSync(currentPath, 'utf8'))
    const executablePath = resolveManagedExecutablePath(rootDir, manifest.executablePath)
    if (
      manifest.schemaVersion !== INSTALLATION_SCHEMA_VERSION
      || !VERSION_PATTERN.test(manifest.version)
      || manifest.releaseTag !== `v${manifest.version}`
      || manifest.targetKey.length === 0
      || !/^[a-f0-9]{64}$/.test(manifest.sha256)
      || !executablePath
      || !statSync(executablePath).isFile()
    ) {
      return null
    }
    const versionManifestPath = path.join(rootDir, 'versions', manifest.version, 'installation.json')
    const versionManifest: OpencodeInstallationManifest = JSON.parse(readFileSync(versionManifestPath, 'utf8'))
    return JSON.stringify(versionManifest) === JSON.stringify(manifest) ? manifest : null
  }
  catch {
    return null
  }
}

function findExecutableOnPath(command: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | null {
  const hasSeparator = command.includes('/') || command.includes('\\')
  const candidates = hasSeparator
    ? [path.resolve(command)]
    : (env.PATH ?? '').split(path.delimiter).filter(Boolean).flatMap((directory) => {
        if (platform !== 'win32') {
          return [path.join(directory, command)]
        }
        const extensions = (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
        return path.extname(command) ? [path.join(directory, command)] : extensions.map(extension => path.join(directory, `${command}${extension.toLowerCase()}`))
      })
  for (const candidate of candidates) {
    try {
      accessSync(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK)
      if (statSync(candidate).isFile()) {
        return path.resolve(candidate)
      }
    }
    catch {
      continue
    }
  }
  return null
}

export function resolveOpencodeExecutable(input: {
  binaryPath?: string
  env?: NodeJS.ProcessEnv
  rootDir?: string
  platform?: NodeJS.Platform
} = {}): ResolvedOpencodeExecutable {
  if (input.binaryPath?.trim()) {
    return { source: 'configured', command: input.binaryPath.trim(), version: null, managed: false }
  }
  const env = input.env ?? process.env
  const platform = input.platform ?? process.platform
  const configured = env.CRADLE_OPENCODE_PATH?.trim()
  if (configured) {
    const command = findExecutableOnPath(configured, env, platform)
    if (!command) {
      throw new AppError({
        code: 'opencode_runtime_probe_failed',
        status: 422,
        message: 'The configured OpenCode executable could not be resolved.',
      })
    }
    return { source: 'configured', command, version: null, managed: false }
  }
  const rootDir = input.rootDir ?? defaultOpencodeRuntimeRoot()
  const managed = readInstallationManifestSync(rootDir)
  if (managed) {
    const command = resolveManagedExecutablePath(rootDir, managed.executablePath)!
    return { source: 'managed', command, version: managed.version, managed: true }
  }
  const command = findExecutableOnPath(platform === 'win32' ? 'opencode.exe' : 'opencode', env, platform)
  if (command) {
    return { source: 'path', command, version: null, managed: false }
  }
  throw new AppError({
    code: 'opencode_runtime_not_installed',
    status: 409,
    message: 'OpenCode CLI is not installed. Install it from Resources.',
  })
}

export async function probeOpencodeVersion(command: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, ['--version'], {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    })
    const match = stdout.trim().match(VERSION_PATTERN)
    if (!match) {
      throw new Error('OpenCode returned an invalid version.')
    }
    return match[1]
  }
  catch (error) {
    throw new AppError({
      code: 'opencode_runtime_probe_failed',
      status: 422,
      message: error instanceof Error ? error.message : 'OpenCode version probe failed.',
    })
  }
}

export async function checkOpencodeRuntimeHealth(input: {
  env?: NodeJS.ProcessEnv
  rootDir?: string
  platform?: NodeJS.Platform
  probeVersion?: (command: string) => Promise<string>
} = {}): Promise<ProviderHealthStatus> {
  const lastCheckedAt = Math.floor(Date.now() / 1000)
  try {
    const executable = resolveOpencodeExecutable(input)
    const version = await (input.probeVersion ?? probeOpencodeVersion)(executable.command)
    return {
      status: 'healthy',
      message: `OpenCode CLI ${version} is available from ${executable.source}.`,
      lastCheckedAt,
    }
  }
  catch (error) {
    const code = error instanceof AppError ? error.code : 'opencode_runtime_probe_failed'
    return {
      status: 'unhealthy',
      message: code === 'opencode_runtime_not_installed'
        ? 'OpenCode CLI is not installed. Install it from Resources.'
        : 'OpenCode CLI could not be verified.',
      lastCheckedAt,
    }
  }
}

export function validateOpencodeArchivePath(entryPath: string): void {
  const normalized = entryPath.replaceAll('\\', '/')
  if (
    entryPath.includes('\0')
    || path.posix.isAbsolute(normalized)
    || path.win32.isAbsolute(entryPath)
    || normalized.split('/').includes('..')
  ) {
    throw new AppError({
      code: 'opencode_runtime_archive_invalid',
      status: 422,
      message: 'OpenCode archive contains an unsafe path.',
    })
  }
}

function readNextZipEntry(zipfile: ZipFile): Promise<Entry | null> {
  return new Promise((resolve, reject) => {
    const onEntry = (entry: Entry): void => {
      cleanup()
      resolve(entry)
    }
    const onEnd = (): void => {
      cleanup()
      resolve(null)
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    const cleanup = (): void => {
      zipfile.off('entry', onEntry)
      zipfile.off('end', onEnd)
      zipfile.off('error', onError)
    }
    zipfile.on('entry', onEntry)
    zipfile.on('end', onEnd)
    zipfile.on('error', onError)
    zipfile.readEntry()
  })
}

async function extractZipExecutable(
  archivePath: string,
  target: ResolvedOpencodeReleaseTarget,
  destination: string,
): Promise<string> {
  let executableRelativePath: string | null = null
  const zipfile = await openZipPromise(archivePath, { lazyEntries: true })
  try {
    for (;;) {
      const entry = await readNextZipEntry(zipfile)
      if (!entry) {
        break
      }
      validateOpencodeArchivePath(entry.fileName)
      const normalized = entry.fileName.replaceAll('\\', '/')
      const isDirectory = normalized.endsWith('/')
      const mode = (entry.externalFileAttributes >> 16) & 0xFFFF
      const fileType = mode & 0o170000
      const isSymlink = fileType === 0o120000
      const isRegular = fileType === 0 || fileType === 0o100000
      if (isSymlink || (!isDirectory && !isRegular)) {
        throw new AppError({ code: 'opencode_runtime_archive_invalid', status: 422, message: 'OpenCode archive contains an unsupported entry.' })
      }
      if (isDirectory) {
        continue
      }
      if (path.posix.basename(normalized) !== target.executableName || executableRelativePath) {
        throw new AppError({ code: 'opencode_runtime_archive_invalid', status: 422, message: 'OpenCode archive contains unexpected executable contents.' })
      }
      executableRelativePath = normalized
      const executablePath = path.resolve(destination, normalized)
      await mkdir(path.dirname(executablePath), { recursive: true })
      const readStream = await zipfile.openReadStreamPromise(entry)
      await pipeline(readStream, createWriteStream(executablePath))
    }
  }
  finally {
    zipfile.close()
  }
  if (!executableRelativePath) {
    throw new AppError({ code: 'opencode_runtime_archive_invalid', status: 422, message: 'OpenCode archive does not contain the CLI executable.' })
  }
  return path.resolve(destination, executableRelativePath)
}

async function extractTarExecutable(
  archivePath: string,
  target: ResolvedOpencodeReleaseTarget,
  destination: string,
): Promise<string> {
  const scan: { error: Error | null, executableRelativePath: string | null } = {
    error: null,
    executableRelativePath: null,
  }
  await listTar({
    file: archivePath,
    strict: true,
    onReadEntry(entry) {
      if (scan.error) {
        return
      }
      try {
        const entryPath = entry.path
        validateOpencodeArchivePath(entryPath)
        const entryType = entry.type
        const isDirectory = entryType === 'Directory'
        if (!isDirectory && entryType !== 'File' && entryType !== 'OldFile') {
          throw new AppError({ code: 'opencode_runtime_archive_invalid', status: 422, message: 'OpenCode archive contains an unsupported entry.' })
        }
        if (isDirectory) {
          return
        }
        if (path.posix.basename(entryPath) !== target.executableName || scan.executableRelativePath) {
          throw new AppError({ code: 'opencode_runtime_archive_invalid', status: 422, message: 'OpenCode archive contains unexpected executable contents.' })
        }
        scan.executableRelativePath = entryPath
      }
      catch (error) {
        scan.error = error instanceof Error
          ? error
          : new AppError({ code: 'opencode_runtime_archive_invalid', status: 422, message: 'OpenCode archive validation failed.' })
      }
    },
  })
  if (scan.error) {
    throw scan.error
  }
  if (!scan.executableRelativePath) {
    throw new AppError({ code: 'opencode_runtime_archive_invalid', status: 422, message: 'OpenCode archive does not contain the CLI executable.' })
  }
  const executableRelativePath = scan.executableRelativePath
  await extractTar({
    file: archivePath,
    cwd: destination,
    strict: true,
    filter: entryPath => entryPath === executableRelativePath,
  })
  return path.resolve(destination, executableRelativePath)
}

export async function extractOpencodeExecutable(
  archivePath: string,
  target: ResolvedOpencodeReleaseTarget,
  destination: string,
): Promise<string> {
  await mkdir(destination, { recursive: true })
  const executablePath = target.format === 'zip'
    ? await extractZipExecutable(archivePath, target, destination)
    : await extractTarExecutable(archivePath, target, destination)
  const stats = await lstat(executablePath)
  if (!stats.isFile() || stats.isSymbolicLink() || !isInside(destination, executablePath)) {
    throw new AppError({ code: 'opencode_runtime_archive_invalid', status: 422, message: 'Extracted OpenCode executable is invalid.' })
  }
  return executablePath
}

async function writeJsonAtomic(filePath: string, value: OpencodeInstallationManifest): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  const handle = await open(temporaryPath, 'wx')
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
  }
  finally {
    await handle.close()
  }
  await rename(temporaryPath, filePath)
}

export class OpencodeRuntimeInstallationService {
  private readonly downloadCenter: OpencodeRuntimeDownloadCenter
  private readonly rootDir: string
  private readonly env: NodeJS.ProcessEnv
  private readonly target: ResolvedOpencodeReleaseTarget | null
  private readonly probeVersion: (command: string) => Promise<string>
  private readonly extractExecutable: NonNullable<OpencodeRuntimeInstallationOptions['extractExecutable']>
  private readonly prepareManagedPathForRemoval: NonNullable<OpencodeRuntimeInstallationOptions['prepareManagedPathForRemoval']>
  private readonly now: () => Date
  private installFlight: Promise<OpencodeRuntimeStatus> | null = null
  private acceptingCommands = true
  private lastErrorCode: string | null = null

  constructor(options: OpencodeRuntimeInstallationOptions) {
    this.downloadCenter = options.downloadCenter
    this.rootDir = options.rootDir ?? defaultOpencodeRuntimeRoot()
    this.env = options.env ?? process.env
    this.target = options.target === undefined ? resolveOpencodeReleaseTarget() : options.target
    this.probeVersion = options.probeVersion ?? probeOpencodeVersion
    this.extractExecutable = options.extractExecutable ?? extractOpencodeExecutable
    this.prepareManagedPathForRemoval = options.prepareManagedPathForRemoval ?? (async () => true)
    this.now = options.now ?? (() => new Date())
  }

  private extractExecutableWithTimeout(
    archivePath: string,
    target: ResolvedOpencodeReleaseTarget,
    destination: string,
  ): Promise<string> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new AppError({
          code: 'opencode_runtime_extract_timeout',
          status: 500,
          message: `OpenCode archive extraction did not finish within ${EXTRACT_TIMEOUT_MS}ms.`,
        }))
      }, EXTRACT_TIMEOUT_MS)
      timer.unref()
    })
    return Promise.race([
      this.extractExecutable(archivePath, target, destination),
      timeout,
    ]).finally(() => {
      clearTimeout(timer)
    })
  }

  async boot(): Promise<void> {
    await mkdir(path.join(this.rootDir, 'versions'), { recursive: true })
    await rm(path.join(this.rootDir, 'staging'), { recursive: true, force: true })
    await mkdir(path.join(this.rootDir, 'staging'), { recursive: true })
    if (!readInstallationManifestSync(this.rootDir)) {
      await rm(path.join(this.rootDir, 'current.json'), { force: true })
    }
    const current = readInstallationManifestSync(this.rootDir)
    const versions = await readdir(path.join(this.rootDir, 'versions'), { withFileTypes: true })
    await Promise.all(versions
      .filter(entry => entry.isDirectory() && entry.name !== current?.version)
      .map(entry => rm(path.join(this.rootDir, 'versions', entry.name), { recursive: true, force: true })))
  }

  async status(ignoreInstallFlight = false): Promise<OpencodeRuntimeStatus> {
    const managedManifest = readInstallationManifestSync(this.rootDir)
    const managedExecutablePath = managedManifest
      ? resolveManagedExecutablePath(this.rootDir, managedManifest.executablePath)
      : null
    const installedSizeBytes = managedExecutablePath
      ? (await stat(managedExecutablePath).catch(() => null))?.size ?? null
      : null
    if (!this.target) {
      return {
        state: 'unavailable',
        source: null,
        version: null,
        targetVersion: OPENCODE_RUNTIME_MANIFEST.sdkVersion,
        managedInstalled: !!managedManifest,
        installedSizeBytes,
        downloadSizeBytes: null,
        errorCode: 'opencode_runtime_target_unsupported',
      }
    }
    if (this.installFlight && !ignoreInstallFlight) {
      return {
        state: 'installing',
        source: managedManifest ? 'managed' : null,
        version: managedManifest?.version ?? null,
        targetVersion: this.target.version,
        managedInstalled: !!managedManifest,
        installedSizeBytes,
        downloadSizeBytes: this.target.sizeBytes,
        errorCode: null,
      }
    }
    try {
      const executable = resolveOpencodeExecutable({ env: this.env, rootDir: this.rootDir })
      const version = executable.version ?? await this.probeVersion(executable.command)
      return {
        state: this.lastErrorCode
          ? 'error'
          : executable.managed && version !== this.target.version ? 'update-available' : 'ready',
        source: executable.source,
        version,
        targetVersion: this.target.version,
        managedInstalled: !!managedManifest,
        installedSizeBytes,
        downloadSizeBytes: this.target.sizeBytes,
        errorCode: this.lastErrorCode,
      }
    }
    catch (error) {
      const code = error instanceof AppError ? error.code : 'opencode_runtime_probe_failed'
      return {
        state: this.lastErrorCode ? 'error' : code === 'opencode_runtime_not_installed' ? 'missing' : 'error',
        source: this.env.CRADLE_OPENCODE_PATH?.trim() ? 'configured' : null,
        version: null,
        targetVersion: this.target.version,
        managedInstalled: !!managedManifest,
        installedSizeBytes,
        downloadSizeBytes: this.target.sizeBytes,
        errorCode: this.lastErrorCode ?? code,
      }
    }
  }

  install(): Promise<OpencodeRuntimeStatus> {
    if (!this.acceptingCommands) {
      throw new AppError({ code: 'opencode_runtime_stopping', status: 503, message: 'OpenCode runtime installation is stopping.' })
    }
    if (this.env.CRADLE_OPENCODE_PATH?.trim()) {
      throw new AppError({ code: 'opencode_runtime_override_active', status: 409, message: 'A configured OpenCode executable override is active.' })
    }
    if (!this.target) {
      throw new AppError({ code: 'opencode_runtime_target_unsupported', status: 409, message: 'This platform does not have a supported OpenCode CLI target.' })
    }
    if (this.installFlight) {
      return this.installFlight
    }
    this.lastErrorCode = null
    const flight = this.installTarget(this.target)
      .catch((error) => {
        this.lastErrorCode = error instanceof AppError ? error.code : 'opencode_runtime_install_failed'
        throw error
      })
      .finally(() => {
        if (this.installFlight === flight) {
          this.installFlight = null
        }
      })
    this.installFlight = flight
    return flight
  }

  async uninstall(): Promise<OpencodeRuntimeStatus> {
    if (!this.acceptingCommands) {
      throw new AppError({ code: 'opencode_runtime_stopping', status: 503, message: 'OpenCode runtime installation is stopping.' })
    }
    if (this.installFlight) {
      throw new AppError({ code: 'opencode_runtime_install_in_progress', status: 409, message: 'OpenCode runtime installation is in progress.' })
    }
    const manifest = readInstallationManifestSync(this.rootDir)
    if (!manifest) {
      throw new AppError({ code: 'opencode_runtime_not_installed', status: 409, message: 'No managed OpenCode runtime is installed.' })
    }
    const executablePaths = await this.listInstalledExecutablePaths(manifest)
    for (const executablePath of executablePaths) {
      if (!await this.prepareManagedPathForRemoval(executablePath)) {
        throw new AppError({ code: 'opencode_runtime_in_use', status: 409, message: 'OpenCode runtime is in use by an active session.' })
      }
    }
    await rm(path.join(this.rootDir, 'current.json'), { force: true })
    await rm(path.join(this.rootDir, 'versions'), { recursive: true, force: true })
    await mkdir(path.join(this.rootDir, 'versions'), { recursive: true })
    this.lastErrorCode = null
    return await this.status()
  }

  async shutdown(): Promise<void> {
    this.acceptingCommands = false
    await this.installFlight?.catch(() => undefined)
  }

  private async listInstalledExecutablePaths(
    current: OpencodeInstallationManifest,
  ): Promise<string[]> {
    const executablePaths = new Set<string>([
      resolveManagedExecutablePath(this.rootDir, current.executablePath)!,
    ])
    const versionEntries = await readdir(path.join(this.rootDir, 'versions'), { withFileTypes: true })
    for (const entry of versionEntries) {
      if (!entry.isDirectory()) {
        continue
      }
      try {
        const installation: OpencodeInstallationManifest = JSON.parse(readFileSync(
          path.join(this.rootDir, 'versions', entry.name, 'installation.json'),
          'utf8',
        ))
        const executablePath = resolveManagedExecutablePath(this.rootDir, installation.executablePath)
        if (
          installation.schemaVersion === INSTALLATION_SCHEMA_VERSION
          && installation.version === entry.name
          && executablePath
          && statSync(executablePath).isFile()
        ) {
          executablePaths.add(executablePath)
        }
      }
      catch {
        // Corrupt orphaned versions were never resolvable and cannot own a live pool lease.
      }
    }
    return [...executablePaths]
  }

  private async installTarget(target: ResolvedOpencodeReleaseTarget): Promise<OpencodeRuntimeStatus> {
    const existing = readInstallationManifestSync(this.rootDir)
    if (existing?.version === target.version && existing.targetKey === target.key && existing.sha256 === target.sha256) {
      return await this.status(true)
    }
    const owner = toManagedResourceDownloadOwner({
      key: { namespace: 'opencode', resourceType: 'runtime', resourceId: 'cli' },
      displayName: 'OpenCode CLI',
      description: 'Optional OpenCode command-line runtime managed by Cradle.',
      kind: 'runtime',
      required: false,
    })
    const sourceId = `github:${OPENCODE_RUNTIME_MANIFEST.repository}:${target.releaseTag}:${target.assetName}`
    const request: DownloadRequest = {
      owner,
      fileName: target.assetName,
      sources: [{ id: sourceId, url: target.downloadUrl }],
      integrity: {
        expectedBytes: target.sizeBytes,
        checksum: { algorithm: 'sha256', value: target.sha256 },
      },
      maxBytes: target.sizeBytes,
    }
    const retryable = this.downloadCenter.findLatestRetryable(owner, sourceId)
    const artifact = retryable
      ? await this.downloadCenter.retry(retryable.taskId, request)
      : await this.downloadCenter.execute(request)
    const operationRoot = path.join(this.rootDir, 'staging', randomUUID())
    const versionStagingRoot = path.join(operationRoot, target.version)
    try {
      const extractedPath = await this.extractExecutableWithTimeout(
        artifact.filePath,
        target,
        path.join(operationRoot, 'extract'),
      )
      const executableRelativePath = path.join('versions', target.version, 'bin', target.executableName)
      const stagedExecutablePath = path.join(versionStagingRoot, 'bin', target.executableName)
      await mkdir(path.dirname(stagedExecutablePath), { recursive: true })
      await rename(extractedPath, stagedExecutablePath)
      if (process.platform !== 'win32') {
        await chmod(stagedExecutablePath, 0o755)
      }
      const version = await this.probeVersion(stagedExecutablePath)
      if (version !== target.version) {
        throw new AppError({ code: 'opencode_runtime_probe_failed', status: 422, message: 'OpenCode executable version does not match the compatible release.' })
      }
      const installation: OpencodeInstallationManifest = {
        schemaVersion: INSTALLATION_SCHEMA_VERSION,
        version: target.version,
        releaseTag: target.releaseTag,
        targetKey: target.key,
        executablePath: executableRelativePath,
        sha256: target.sha256,
        installedAt: this.now().toISOString(),
      }
      await writeJsonAtomic(path.join(versionStagingRoot, 'installation.json'), installation)
      const versionRoot = path.join(this.rootDir, 'versions', target.version)
      if (existsSync(versionRoot)) {
        throw new AppError({
          code: 'opencode_runtime_install_conflict',
          status: 409,
          message: 'The compatible OpenCode version directory already exists without a valid installation pointer.',
        })
      }
      await rename(versionStagingRoot, versionRoot)
      await writeJsonAtomic(path.join(this.rootDir, 'current.json'), installation)
      this.lastErrorCode = null
      return await this.status(true)
    }
    finally {
      await rm(operationRoot, { recursive: true, force: true })
      await this.downloadCenter.release(artifact.taskId).catch(() => undefined)
    }
  }
}
