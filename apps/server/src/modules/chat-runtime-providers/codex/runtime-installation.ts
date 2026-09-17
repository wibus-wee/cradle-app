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
  VersionedInstallation,
} from '@cradle/download-center/installation'

import { AppError } from '../../../errors/app-error'
import { toManagedResourceDownloadOwner } from '../../managed-resources/service'
import { resolveCodexAppServerHome } from './app-server/runtime-home'
import type { ResolvedCodexReleaseAsset, ResolvedCodexReleaseTarget } from './runtime-release'
import { CODEX_RUNTIME_MANIFEST, resolveCodexReleaseTarget } from './runtime-release'

const execFileAsync = promisify(execFile)
const INSTALLATION_SCHEMA_VERSION = 1
const VERSION_PATTERN = /\b\d+\.\d+\.\d+(?:[-+][0-9A-Z.-]+)?\b/i
const EXTRACT_TIMEOUT_MS = 60_000
const PROBE_TIMEOUT_MS = 5_000

export type CodexExecutableSource = 'configured' | 'managed' | 'path' | 'cli'

export interface ResolvedCodexAppServerExecutable {
  source: CodexExecutableSource
  command: string
  version: string | null
  managed: boolean
}

interface CodexInstallationManifest {
  schemaVersion: 1
  version: string
  releaseTag: string
  targetKey: string
  appServerPath: string
  codeModeHostPath: string
  sha256: { appServer: string, codeModeHost: string }
  installedAt: string
}

export interface CodexRuntimeStatus {
  state: 'ready' | 'missing' | 'installing' | 'update-available' | 'error' | 'unavailable'
  source: CodexExecutableSource | null
  version: string | null
  targetVersion: string
  managedInstalled: boolean
  installedSizeBytes: number | null
  downloadSizeBytes: number | null
  errorCode: string | null
}

export interface CodexRuntimeDownloadCenter {
  execute: (request: DownloadRequest) => Promise<DownloadedArtifact>
  retry: (taskId: string, request: DownloadRequest) => Promise<DownloadedArtifact>
  release: (taskId: string) => Promise<unknown>
  findLatestRetryable: (
    owner: DownloadRequest['owner'],
    sourceId: string,
  ) => { taskId: string, updatedAt: string } | null
}

export interface CodexRuntimeInstallationOptions {
  downloadCenter: CodexRuntimeDownloadCenter
  rootDir?: string
  env?: NodeJS.ProcessEnv
  target?: ResolvedCodexReleaseTarget | null
  probeVersion?: (command: string) => Promise<string | null>
  extractExecutable?: (
    archivePath: string,
    asset: ResolvedCodexReleaseAsset,
    destination: string,
  ) => Promise<string>
  prepareManagedPathForRemoval?: (binaryPath: string) => Promise<boolean>
  now?: () => Date
}

export function defaultCodexRuntimeRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveCodexAppServerHome({ env }), 'managed')
}

const createCodexError: InstallationErrorFactory = (code, status, message) =>
  new AppError({ code: `codex_runtime_${code}`, status, message })

function parseCodexInstallationManifest(raw: unknown): CodexInstallationManifest | null {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }
  const manifest = raw as CodexInstallationManifest
  return manifest.schemaVersion === INSTALLATION_SCHEMA_VERSION
    && typeof manifest.version === 'string'
    && VERSION_PATTERN.test(manifest.version)
    && manifest.releaseTag === `rust-v${manifest.version}`
    && typeof manifest.targetKey === 'string'
    && manifest.targetKey.length > 0
    && typeof manifest.appServerPath === 'string'
    && typeof manifest.codeModeHostPath === 'string'
    && typeof manifest.sha256 === 'object'
    && manifest.sha256 !== null
    && /^[a-f0-9]{64}$/.test(manifest.sha256.appServer)
    && /^[a-f0-9]{64}$/.test(manifest.sha256.codeModeHost)
    && typeof manifest.installedAt === 'string'
    ? manifest
    : null
}

function codexPayloadPaths(manifest: CodexInstallationManifest) {
  return [
    { path: manifest.appServerPath, kind: 'file' as const },
    { path: manifest.codeModeHostPath, kind: 'file' as const },
  ]
}

function readCodexInstallation(rootDir: string): CodexInstallationManifest | null {
  return readCurrentInstallation({
    rootDir,
    parseManifest: parseCodexInstallationManifest,
    payloadPaths: codexPayloadPaths,
  })
}

/**
 * Absolute path to the managed `codex-app-server` executable, or null when no
 * valid managed installation exists. Used by launch resolution — keep sync.
 */
export function resolveCodexManagedAppServerPath(input: {
  env?: NodeJS.ProcessEnv
  rootDir?: string
} = {}): string | null {
  const rootDir = input.rootDir ?? defaultCodexRuntimeRoot(input.env)
  const manifest = readCodexInstallation(rootDir)
  return manifest ? resolveManagedPath(rootDir, manifest.appServerPath) : null
}

/**
 * Resolve which app-server the Codex runtime would use, mirroring the launch
 * chain: explicit configuration, managed installation, PATH `codex-app-server`,
 * then the `codex` CLI fallback. Returns null only when not even the CLI
 * fallback binary exists.
 */
export function resolveCodexAppServerExecutable(input: {
  appServerPath?: string
  codexCliPath?: string
  env?: NodeJS.ProcessEnv
  rootDir?: string
  platform?: NodeJS.Platform
} = {}): ResolvedCodexAppServerExecutable | null {
  const env = input.env ?? process.env
  const platform = input.platform ?? process.platform
  const configured = input.appServerPath?.trim() || env.CRADLE_CODEX_APP_SERVER_PATH?.trim()
  if (configured) {
    return { source: 'configured', command: configured, version: null, managed: false }
  }
  const rootDir = input.rootDir ?? defaultCodexRuntimeRoot(env)
  const managed = readCodexInstallation(rootDir)
  if (managed) {
    const command = resolveManagedPath(rootDir, managed.appServerPath)!
    return { source: 'managed', command, version: managed.version, managed: true }
  }
  const pathAppServer = findExecutableOnPath(
    platform === 'win32' ? 'codex-app-server.exe' : 'codex-app-server',
    env,
    platform,
  )
  if (pathAppServer) {
    return { source: 'path', command: pathAppServer, version: null, managed: false }
  }
  const cliCommand = input.codexCliPath?.trim()
    || findExecutableOnPath(platform === 'win32' ? 'codex.exe' : 'codex', env, platform)
  if (cliCommand) {
    return { source: 'cli', command: cliCommand, version: null, managed: false }
  }
  return null
}

/**
 * Best-effort version probe. A bare `codex-app-server` may block on stdio or
 * reject `--version`, so probe failures return null — payload integrity is
 * already pinned by the manifest checksum. Only a parsed version that does not
 * match the target release fails the install.
 */
export async function probeCodexAppServerVersion(command: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(command, ['--version'], {
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
    })
    return `${stdout}\n${stderr}`.match(VERSION_PATTERN)?.[0] ?? null
  }
  catch {
    return null
  }
}

function singleExecutableSpec(candidateBasenames: readonly string[]): ArchivePayloadSpec {
  const candidates = new Set(candidateBasenames)
  return {
    classify: (normalizedPath, payloadPaths) =>
      candidates.has(path.posix.basename(normalizedPath)) && payloadPaths.length === 0
        ? 'payload'
        : 'ignore',
    isComplete: payloadPaths => payloadPaths.length === 1,
  }
}

export async function extractCodexExecutable(
  archivePath: string,
  asset: ResolvedCodexReleaseAsset,
  destination: string,
): Promise<string> {
  const extractedPaths = await extractArchivePayload({
    archivePath,
    format: 'tar',
    destination,
    spec: singleExecutableSpec(asset.candidateBasenames),
    createError: createCodexError,
  })
  if (extractedPaths.length !== 1) {
    throw new AppError({
      code: 'codex_runtime_archive_invalid',
      status: 422,
      message: `Codex archive did not contain the ${asset.executableName} payload.`,
    })
  }
  return extractedPaths[0]!
}

export class CodexRuntimeInstallationService {
  private readonly downloadCenter: CodexRuntimeDownloadCenter
  private readonly installation: VersionedInstallation<CodexInstallationManifest>
  private readonly env: NodeJS.ProcessEnv
  private readonly target: ResolvedCodexReleaseTarget | null
  private readonly probeVersion: (command: string) => Promise<string | null>
  private readonly extractExecutable: NonNullable<CodexRuntimeInstallationOptions['extractExecutable']>
  private readonly now: () => Date
  private lastErrorCode: string | null = null

  constructor(options: CodexRuntimeInstallationOptions) {
    this.downloadCenter = options.downloadCenter
    this.env = options.env ?? process.env
    this.target = options.target === undefined ? resolveCodexReleaseTarget() : options.target
    this.probeVersion = options.probeVersion ?? probeCodexAppServerVersion
    this.extractExecutable = options.extractExecutable ?? extractCodexExecutable
    this.now = options.now ?? (() => new Date())
    this.installation = new VersionedInstallation({
      rootDir: options.rootDir ?? defaultCodexRuntimeRoot(this.env),
      label: 'Codex runtime',
      parseManifest: parseCodexInstallationManifest,
      payloadPaths: codexPayloadPaths,
      prepareForRemoval: options.prepareManagedPathForRemoval,
      createError: createCodexError,
    })
  }

  private extractExecutableWithTimeout(
    archivePath: string,
    asset: ResolvedCodexReleaseAsset,
    destination: string,
  ): Promise<string> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new AppError({
          code: 'codex_runtime_extract_timeout',
          status: 500,
          message: `Codex archive extraction did not finish within ${EXTRACT_TIMEOUT_MS}ms.`,
        }))
      }, EXTRACT_TIMEOUT_MS)
      timer.unref()
    })
    return Promise.race([
      this.extractExecutable(archivePath, asset, destination),
      timeout,
    ]).finally(() => {
      clearTimeout(timer)
    })
  }

  async boot(): Promise<void> {
    await this.installation.boot()
  }

  async status(ignoreInstallFlight = false): Promise<CodexRuntimeStatus> {
    const managedManifest = this.installation.current()
    const payloadPaths = managedManifest
      ? [
          this.installation.resolvePath(managedManifest.appServerPath),
          this.installation.resolvePath(managedManifest.codeModeHostPath),
        ]
      : []
    const payloadSizes = await Promise.all(payloadPaths.map(async (payloadPath) => {
      return payloadPath ? (await stat(payloadPath).catch(() => null))?.size ?? 0 : 0
    }))
    const installedSizeBytes = managedManifest
      ? payloadSizes.reduce((sum, size) => sum + size, 0)
      : null
    if (!this.target) {
      return {
        state: 'unavailable',
        source: null,
        version: null,
        targetVersion: CODEX_RUNTIME_MANIFEST.sdkVersion,
        managedInstalled: !!managedManifest,
        installedSizeBytes,
        downloadSizeBytes: null,
        errorCode: 'codex_runtime_target_unsupported',
      }
    }
    const downloadSizeBytes = this.target.appServer.sizeBytes + this.target.codeModeHost.sizeBytes
    if (this.installation.isInstalling() && !ignoreInstallFlight) {
      return {
        state: 'installing',
        source: managedManifest ? 'managed' : null,
        version: managedManifest?.version ?? null,
        targetVersion: this.target.version,
        managedInstalled: !!managedManifest,
        installedSizeBytes,
        downloadSizeBytes,
        errorCode: null,
      }
    }
    const executable = resolveCodexAppServerExecutable({
      env: this.env,
      rootDir: this.installation.rootDir,
    })
    if (!executable) {
      return {
        state: this.lastErrorCode ? 'error' : 'missing',
        source: this.env.CRADLE_CODEX_APP_SERVER_PATH?.trim() ? 'configured' : null,
        version: null,
        targetVersion: this.target.version,
        managedInstalled: !!managedManifest,
        installedSizeBytes,
        downloadSizeBytes,
        errorCode: this.lastErrorCode ?? 'codex_runtime_not_installed',
      }
    }
    const version = executable.version
    return {
      state: this.lastErrorCode
        ? 'error'
        : executable.managed && version !== this.target.version ? 'update-available' : 'ready',
      source: executable.source,
      version,
      targetVersion: this.target.version,
      managedInstalled: !!managedManifest,
      installedSizeBytes,
      downloadSizeBytes,
      errorCode: this.lastErrorCode,
    }
  }

  install(): Promise<CodexRuntimeStatus> {
    if (!this.installation.accepting) {
      throw new AppError({ code: 'codex_runtime_stopping', status: 503, message: 'Codex runtime installation is stopping.' })
    }
    if (this.env.CRADLE_CODEX_APP_SERVER_PATH?.trim()) {
      throw new AppError({ code: 'codex_runtime_override_active', status: 409, message: 'A configured Codex app-server override is active.' })
    }
    if (!this.target) {
      throw new AppError({ code: 'codex_runtime_target_unsupported', status: 409, message: 'This platform does not have a supported Codex runtime target.' })
    }
    const target = this.target
    return this.installation.install(async () => {
      try {
        return await this.installTarget(target)
      }
      catch (error) {
        this.lastErrorCode = error instanceof AppError ? error.code : 'codex_runtime_install_failed'
        throw error
      }
    })
  }

  async uninstall(): Promise<CodexRuntimeStatus> {
    await this.installation.uninstall()
    this.lastErrorCode = null
    return await this.status()
  }

  async shutdown(): Promise<void> {
    await this.installation.shutdown()
  }

  private async downloadAsset(
    owner: ReturnType<typeof toManagedResourceDownloadOwner>,
    target: ResolvedCodexReleaseTarget,
    asset: ResolvedCodexReleaseAsset,
  ): Promise<DownloadedArtifact> {
    const sourceId = `github:${CODEX_RUNTIME_MANIFEST.repository}:${target.releaseTag}:${asset.assetName}`
    const request: DownloadRequest = {
      owner,
      fileName: asset.assetName,
      sources: [{ id: sourceId, url: asset.downloadUrl }],
      integrity: {
        expectedBytes: asset.sizeBytes,
        checksum: { algorithm: 'sha256', value: asset.sha256 },
      },
      maxBytes: asset.sizeBytes,
    }
    const retryable = this.downloadCenter.findLatestRetryable(owner, sourceId)
    return retryable
      ? await this.downloadCenter.retry(retryable.taskId, request)
      : await this.downloadCenter.execute(request)
  }

  private async installTarget(target: ResolvedCodexReleaseTarget): Promise<CodexRuntimeStatus> {
    const existing = this.installation.current()
    if (existing?.version === target.version
      && existing.targetKey === target.key
      && existing.sha256.appServer === target.appServer.sha256
      && existing.sha256.codeModeHost === target.codeModeHost.sha256) {
      return await this.status(true)
    }
    const owner = toManagedResourceDownloadOwner({
      key: { namespace: 'codex', resourceType: 'runtime', resourceId: 'app-server' },
      displayName: 'Codex app-server',
      description: 'Codex app-server runtime managed by Cradle.',
      kind: 'runtime',
      required: true,
    })
    const appServerArtifact = await this.downloadAsset(owner, target, target.appServer)
    let codeModeHostArtifact: DownloadedArtifact | null = null
    try {
      const downloadedCodeModeHost = await this.downloadAsset(owner, target, target.codeModeHost)
      codeModeHostArtifact = downloadedCodeModeHost
      await this.installation.stageVersion({
        version: target.version,
        stage: async (versionStagingRoot, operationRoot) => {
          const [appServerExtractedPath, codeModeHostExtractedPath] = await Promise.all([
            this.extractExecutableWithTimeout(
              appServerArtifact.filePath,
              target.appServer,
              path.join(operationRoot, 'extract-app-server'),
            ),
            this.extractExecutableWithTimeout(
              downloadedCodeModeHost.filePath,
              target.codeModeHost,
              path.join(operationRoot, 'extract-code-mode-host'),
            ),
          ])
          const binDir = path.join(versionStagingRoot, 'bin')
          const appServerStagedPath = path.join(binDir, target.appServer.executableName)
          const codeModeHostStagedPath = path.join(binDir, target.codeModeHost.executableName)
          await mkdir(binDir, { recursive: true })
          await rename(appServerExtractedPath, appServerStagedPath)
          await rename(codeModeHostExtractedPath, codeModeHostStagedPath)
          if (process.platform !== 'win32') {
            await chmod(appServerStagedPath, 0o755)
            await chmod(codeModeHostStagedPath, 0o755)
          }
          const probedVersion = await this.probeVersion(appServerStagedPath)
          if (probedVersion && probedVersion !== target.version) {
            throw new AppError({
              code: 'codex_runtime_probe_failed',
              status: 422,
              message: 'Codex app-server version does not match the vendored protocol release.',
            })
          }
          return {
            schemaVersion: INSTALLATION_SCHEMA_VERSION,
            version: target.version,
            releaseTag: target.releaseTag,
            targetKey: target.key,
            appServerPath: path.join('versions', target.version, 'bin', target.appServer.executableName),
            codeModeHostPath: path.join('versions', target.version, 'bin', target.codeModeHost.executableName),
            sha256: {
              appServer: target.appServer.sha256,
              codeModeHost: target.codeModeHost.sha256,
            },
            installedAt: this.now().toISOString(),
          } satisfies CodexInstallationManifest
        },
      })
      this.lastErrorCode = null
      return await this.status(true)
    }
    finally {
      await this.downloadCenter.release(appServerArtifact.taskId).catch(() => undefined)
      if (codeModeHostArtifact) {
        await this.downloadCenter.release(codeModeHostArtifact.taskId).catch(() => undefined)
      }
    }
  }
}
