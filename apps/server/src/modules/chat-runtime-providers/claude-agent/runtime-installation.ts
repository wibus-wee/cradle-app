import { execFile } from 'node:child_process'
import { chmod, mkdir, rename, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import type { DownloadedArtifact, DownloadRequest } from '@cradle/download-center'
import type { ArchivePayloadSpec } from '@cradle/download-center/installation'
import {
  extractArchivePayload,
  VersionedInstallation,
} from '@cradle/download-center/installation'

import { AppError } from '../../../errors/app-error'
import { toManagedResourceDownloadOwner } from '../../managed-resources/service'
import type { ClaudeCodeInstallationManifest } from './runtime-executable'
import {
  CLAUDE_CODE_PATH_ENV,
  claudeCodePayloadPaths,
  defaultClaudeRuntimeRoot,
  parseClaudeCodeInstallationManifest,
  prepareClaudeManagedPathForRemoval,
  resolveClaudeAgentExecutable,
} from './runtime-executable'
import type { ResolvedClaudeCodeReleaseTarget } from './runtime-release'
import { CLAUDE_CODE_RUNTIME_MANIFEST, resolveClaudeCodeReleaseTarget } from './runtime-release'

const execFileAsync = promisify(execFile)
const VERSION_PATTERN = /\b\d+\.\d+\.\d+(?:[-+][0-9A-Z.-]+)?\b/i
const EXTRACT_TIMEOUT_MS = 60_000
const PROBE_TIMEOUT_MS = 10_000
/** Tarballs carry a ~200 MB uncompressed binary; npm publishes no compressed size. */
const DOWNLOAD_MAX_BYTES = 512 * 1024 * 1024

export interface ClaudeCodeRuntimeStatus {
  state: 'ready' | 'missing' | 'installing' | 'update-available' | 'error' | 'unavailable'
  source: 'configured' | 'managed' | 'sdk-bundled' | 'path' | null
  version: string | null
  targetVersion: string
  managedInstalled: boolean
  installedSizeBytes: number | null
  downloadSizeBytes: number | null
  errorCode: string | null
}

export interface ClaudeCodeRuntimeDownloadCenter {
  execute: (request: DownloadRequest) => Promise<DownloadedArtifact>
  retry: (taskId: string, request: DownloadRequest) => Promise<DownloadedArtifact>
  release: (taskId: string) => Promise<unknown>
  findLatestRetryable: (
    owner: DownloadRequest['owner'],
    sourceId: string,
  ) => { taskId: string, updatedAt: string } | null
}

export interface ClaudeCodeRuntimeInstallationOptions {
  downloadCenter: ClaudeCodeRuntimeDownloadCenter
  rootDir?: string
  env?: NodeJS.ProcessEnv
  target?: ResolvedClaudeCodeReleaseTarget | null
  resolveExecutable?: typeof resolveClaudeAgentExecutable
  probeVersion?: (command: string) => Promise<string | null>
  extractExecutable?: (
    archivePath: string,
    target: ResolvedClaudeCodeReleaseTarget,
    destination: string,
  ) => Promise<string>
  prepareManagedPathForRemoval?: (binaryPath: string) => Promise<boolean>
  now?: () => Date
}

const createClaudeError = (code: string, status: number, message: string) =>
  new AppError({ code: `claude_agent_runtime_${code}`, status, message })

function npmPackageSpec(): ArchivePayloadSpec {
  return {
    classify: (normalizedPath, payloadPaths) => {
      const basename = path.posix.basename(normalizedPath)
      return (basename === 'claude' || basename === 'claude.exe') && payloadPaths.length === 0
        ? 'payload'
        : 'ignore'
    },
    isComplete: payloadPaths => payloadPaths.length === 1,
  }
}

export async function extractClaudeExecutable(
  archivePath: string,
  target: ResolvedClaudeCodeReleaseTarget,
  destination: string,
): Promise<string> {
  const extractedPaths = await extractArchivePayload({
    archivePath,
    format: 'tar',
    destination,
    spec: npmPackageSpec(),
    createError: createClaudeError,
  })
  if (extractedPaths.length !== 1) {
    throw new AppError({
      code: 'claude_agent_runtime_archive_invalid',
      status: 422,
      message: `Claude Code package did not contain the ${target.executableName} payload.`,
    })
  }
  return extractedPaths[0]!
}

/**
 * Best-effort version probe, same posture as the Codex probe: `claude --version`
 * failures return null — payload integrity is already pinned by the manifest
 * checksum. Only a parsed version mismatch fails the install.
 */
export async function probeClaudeExecutableVersion(command: string): Promise<string | null> {
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

export class ClaudeCodeRuntimeInstallationService {
  private readonly downloadCenter: ClaudeCodeRuntimeDownloadCenter
  private readonly installation: VersionedInstallation<ClaudeCodeInstallationManifest>
  private readonly env: NodeJS.ProcessEnv
  private readonly target: ResolvedClaudeCodeReleaseTarget | null
  private readonly resolveExecutable: typeof resolveClaudeAgentExecutable
  private readonly probeVersion: (command: string) => Promise<string | null>
  private readonly extractExecutable: NonNullable<ClaudeCodeRuntimeInstallationOptions['extractExecutable']>
  private readonly now: () => Date
  private lastErrorCode: string | null = null

  constructor(options: ClaudeCodeRuntimeInstallationOptions) {
    this.downloadCenter = options.downloadCenter
    this.env = options.env ?? process.env
    this.target = options.target === undefined ? resolveClaudeCodeReleaseTarget() : options.target
    this.resolveExecutable = options.resolveExecutable ?? resolveClaudeAgentExecutable
    this.probeVersion = options.probeVersion ?? probeClaudeExecutableVersion
    this.extractExecutable = options.extractExecutable ?? extractClaudeExecutable
    this.now = options.now ?? (() => new Date())
    this.installation = new VersionedInstallation({
      rootDir: options.rootDir ?? defaultClaudeRuntimeRoot(this.env),
      label: 'Claude Code runtime',
      parseManifest: parseClaudeCodeInstallationManifest,
      payloadPaths: claudeCodePayloadPaths,
      prepareForRemoval: options.prepareManagedPathForRemoval ?? prepareClaudeManagedPathForRemoval,
      createError: createClaudeError,
    })
  }

  private extractExecutableWithTimeout(
    archivePath: string,
    target: ResolvedClaudeCodeReleaseTarget,
    destination: string,
  ): Promise<string> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new AppError({
          code: 'claude_agent_runtime_extract_timeout',
          status: 500,
          message: `Claude Code package extraction did not finish within ${EXTRACT_TIMEOUT_MS}ms.`,
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

  async status(ignoreInstallFlight = false): Promise<ClaudeCodeRuntimeStatus> {
    const managedManifest = this.installation.current()
    const executablePath = managedManifest
      ? this.installation.resolvePath(managedManifest.executablePath)
      : null
    const installedSizeBytes = executablePath
      ? (await stat(executablePath).catch(() => null))?.size ?? null
      : null
    if (!this.target) {
      return {
        state: 'unavailable',
        source: null,
        version: null,
        targetVersion: CLAUDE_CODE_RUNTIME_MANIFEST.sdkVersion,
        managedInstalled: !!managedManifest,
        installedSizeBytes,
        downloadSizeBytes: null,
        errorCode: 'claude_agent_runtime_target_unsupported',
      }
    }
    const downloadSizeBytes = this.target.unpackedSizeBytes
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
    const executable = this.resolveExecutable({ env: this.env, rootDir: this.installation.rootDir })
    if (!executable) {
      return {
        state: this.lastErrorCode ? 'error' : 'missing',
        source: this.env[CLAUDE_CODE_PATH_ENV]?.trim() ? 'configured' : null,
        version: null,
        targetVersion: this.target.version,
        managedInstalled: !!managedManifest,
        installedSizeBytes,
        downloadSizeBytes,
        errorCode: this.lastErrorCode ?? 'claude_agent_runtime_not_installed',
      }
    }
    return {
      state: this.lastErrorCode
        ? 'error'
        : executable.managed && executable.version !== this.target.version ? 'update-available' : 'ready',
      source: executable.source,
      version: executable.version,
      targetVersion: this.target.version,
      managedInstalled: !!managedManifest,
      installedSizeBytes,
      downloadSizeBytes,
      errorCode: this.lastErrorCode,
    }
  }

  install(): Promise<ClaudeCodeRuntimeStatus> {
    if (!this.installation.accepting) {
      throw new AppError({ code: 'claude_agent_runtime_stopping', status: 503, message: 'Claude Code runtime installation is stopping.' })
    }
    if (this.env[CLAUDE_CODE_PATH_ENV]?.trim()) {
      throw new AppError({ code: 'claude_agent_runtime_override_active', status: 409, message: `A configured Claude Code executable override (${CLAUDE_CODE_PATH_ENV}) is active.` })
    }
    if (!this.target) {
      throw new AppError({ code: 'claude_agent_runtime_target_unsupported', status: 409, message: 'This platform does not have a supported Claude Code runtime target.' })
    }
    const target = this.target
    return this.installation.install(async () => {
      try {
        return await this.installTarget(target)
      }
      catch (error) {
        this.lastErrorCode = error instanceof AppError ? error.code : 'claude_agent_runtime_install_failed'
        throw error
      }
    })
  }

  async uninstall(): Promise<ClaudeCodeRuntimeStatus> {
    await this.installation.uninstall()
    this.lastErrorCode = null
    return await this.status()
  }

  async shutdown(): Promise<void> {
    await this.installation.shutdown()
  }

  private async installTarget(target: ResolvedClaudeCodeReleaseTarget): Promise<ClaudeCodeRuntimeStatus> {
    const existing = this.installation.current()
    if (existing?.version === target.version
      && existing.targetKey === target.key
      && existing.sha512 === target.sha512) {
      return await this.status(true)
    }
    const owner = toManagedResourceDownloadOwner({
      key: { namespace: 'claude-agent', resourceType: 'runtime', resourceId: 'cli' },
      displayName: 'Claude Code runtime',
      description: 'Claude Code runtime managed by Cradle.',
      kind: 'runtime',
      required: false,
    })
    const sourceId = `npm:${target.packageName}:${target.version}`
    const request: DownloadRequest = {
      owner,
      fileName: path.posix.basename(new URL(target.downloadUrl).pathname),
      sources: [{ id: sourceId, url: target.downloadUrl }],
      integrity: {
        checksum: { algorithm: 'sha512', value: target.sha512 },
      },
      maxBytes: DOWNLOAD_MAX_BYTES,
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
          const binDir = path.join(versionStagingRoot, 'bin')
          const stagedPath = path.join(binDir, target.executableName)
          await mkdir(binDir, { recursive: true })
          await rename(extractedPath, stagedPath)
          if (process.platform !== 'win32') {
            await chmod(stagedPath, 0o755)
          }
          const probedVersion = await this.probeVersion(stagedPath)
          if (probedVersion && probedVersion !== target.version) {
            throw new AppError({
              code: 'claude_agent_runtime_probe_failed',
              status: 422,
              message: 'Claude Code executable version does not match the pinned SDK platform package.',
            })
          }
          return {
            schemaVersion: 1,
            version: target.version,
            targetKey: target.key,
            executablePath: path.join('versions', target.version, 'bin', target.executableName),
            sha512: target.sha512,
            installedAt: this.now().toISOString(),
          } satisfies ClaudeCodeInstallationManifest
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
