import { execFile } from 'node:child_process'
import { chmod, mkdir, rename, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import type { DownloadedArtifact, DownloadRequest } from '@cradle/download-center'
import type { ArchivePayloadSpec, InstallationErrorFactory } from '@cradle/download-center/installation'
import {
  extractArchivePayload,
  findExecutableOnPath,
  readCurrentInstallation,
  resolveManagedPath,
  validateArchiveEntryPath,
  VersionedInstallation,
} from '@cradle/download-center/installation'

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

const createOpencodeError: InstallationErrorFactory = (code, status, message) =>
  new AppError({ code: `opencode_runtime_${code}`, status, message })

function parseOpencodeInstallationManifest(raw: unknown): OpencodeInstallationManifest | null {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }
  const manifest = raw as OpencodeInstallationManifest
  return manifest.schemaVersion === INSTALLATION_SCHEMA_VERSION
    && typeof manifest.version === 'string'
    && VERSION_PATTERN.test(manifest.version)
    && manifest.releaseTag === `v${manifest.version}`
    && typeof manifest.targetKey === 'string'
    && manifest.targetKey.length > 0
    && typeof manifest.sha256 === 'string'
    && /^[a-f0-9]{64}$/.test(manifest.sha256)
    && typeof manifest.executablePath === 'string'
    ? manifest
    : null
}

function opencodePayloadPaths(manifest: OpencodeInstallationManifest) {
  return [{ path: manifest.executablePath, kind: 'file' as const }]
}

function readOpencodeInstallation(rootDir: string): OpencodeInstallationManifest | null {
  return readCurrentInstallation({
    rootDir,
    parseManifest: parseOpencodeInstallationManifest,
    payloadPaths: opencodePayloadPaths,
  })
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
  const managed = readOpencodeInstallation(rootDir)
  if (managed) {
    const command = resolveManagedPath(rootDir, managed.executablePath)!
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
  validateArchiveEntryPath(entryPath, createOpencodeError)
}

function singleExecutableSpec(executableName: string): ArchivePayloadSpec {
  return {
    classify: (normalizedPath, payloadPaths) =>
      path.posix.basename(normalizedPath) === executableName && payloadPaths.length === 0
        ? 'payload'
        : 'reject',
    isComplete: payloadPaths => payloadPaths.length === 1,
  }
}

export async function extractOpencodeExecutable(
  archivePath: string,
  target: ResolvedOpencodeReleaseTarget,
  destination: string,
): Promise<string> {
  const extractedPaths = await extractArchivePayload({
    archivePath,
    format: target.format === 'zip' ? 'zip' : 'tar',
    destination,
    spec: singleExecutableSpec(target.executableName),
    createError: createOpencodeError,
  })
  return extractedPaths[0]!
}

export class OpencodeRuntimeInstallationService {
  private readonly downloadCenter: OpencodeRuntimeDownloadCenter
  private readonly installation: VersionedInstallation<OpencodeInstallationManifest>
  private readonly env: NodeJS.ProcessEnv
  private readonly target: ResolvedOpencodeReleaseTarget | null
  private readonly probeVersion: (command: string) => Promise<string>
  private readonly extractExecutable: NonNullable<OpencodeRuntimeInstallationOptions['extractExecutable']>
  private readonly now: () => Date
  private lastErrorCode: string | null = null

  constructor(options: OpencodeRuntimeInstallationOptions) {
    this.downloadCenter = options.downloadCenter
    this.env = options.env ?? process.env
    this.target = options.target === undefined ? resolveOpencodeReleaseTarget() : options.target
    this.probeVersion = options.probeVersion ?? probeOpencodeVersion
    this.extractExecutable = options.extractExecutable ?? extractOpencodeExecutable
    this.now = options.now ?? (() => new Date())
    this.installation = new VersionedInstallation({
      rootDir: options.rootDir ?? defaultOpencodeRuntimeRoot(),
      label: 'OpenCode runtime',
      parseManifest: parseOpencodeInstallationManifest,
      payloadPaths: opencodePayloadPaths,
      prepareForRemoval: options.prepareManagedPathForRemoval,
      createError: createOpencodeError,
    })
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
    await this.installation.boot()
  }

  async status(ignoreInstallFlight = false): Promise<OpencodeRuntimeStatus> {
    const managedManifest = this.installation.current()
    const managedExecutablePath = managedManifest
      ? this.installation.resolvePath(managedManifest.executablePath)
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
    if (this.installation.isInstalling() && !ignoreInstallFlight) {
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
      const executable = resolveOpencodeExecutable({ env: this.env, rootDir: this.installation.rootDir })
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
    if (!this.installation.accepting) {
      throw new AppError({ code: 'opencode_runtime_stopping', status: 503, message: 'OpenCode runtime installation is stopping.' })
    }
    if (this.env.CRADLE_OPENCODE_PATH?.trim()) {
      throw new AppError({ code: 'opencode_runtime_override_active', status: 409, message: 'A configured OpenCode executable override is active.' })
    }
    if (!this.target) {
      throw new AppError({ code: 'opencode_runtime_target_unsupported', status: 409, message: 'This platform does not have a supported OpenCode CLI target.' })
    }
    const target = this.target
    return this.installation.install(async () => {
      try {
        return await this.installTarget(target)
      }
      catch (error) {
        this.lastErrorCode = error instanceof AppError ? error.code : 'opencode_runtime_install_failed'
        throw error
      }
    })
  }

  async uninstall(): Promise<OpencodeRuntimeStatus> {
    await this.installation.uninstall()
    this.lastErrorCode = null
    return await this.status()
  }

  async shutdown(): Promise<void> {
    await this.installation.shutdown()
  }

  private async installTarget(target: ResolvedOpencodeReleaseTarget): Promise<OpencodeRuntimeStatus> {
    const existing = this.installation.current()
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
    try {
      await this.installation.stageVersion({
        version: target.version,
        stage: async (versionStagingRoot, operationRoot) => {
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
          return {
            schemaVersion: INSTALLATION_SCHEMA_VERSION,
            version: target.version,
            releaseTag: target.releaseTag,
            targetKey: target.key,
            executablePath: executableRelativePath,
            sha256: target.sha256,
            installedAt: this.now().toISOString(),
          } satisfies OpencodeInstallationManifest
        },
      })
      this.lastErrorCode = null
      return await this.status(true)
    }
    finally {
      await this.downloadCenter.release(artifact.taskId).catch(() => undefined)
    }
  }
}
