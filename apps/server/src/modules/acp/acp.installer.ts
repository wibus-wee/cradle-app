import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import { join, normalize, sep } from 'node:path'
import { promisify } from 'node:util'

import type { DownloadedArtifact, DownloadRequest, DownloadTaskView } from '@cradle/download-center'

import { AppError } from '../../errors/app-error'
import type { AcpDistributionType, PackageDistribution, RegistryAgent } from './acp.registry'
import { getPlatformKey } from './acp.registry'

const execFileAsync = promisify(execFile)

const AGENT_ID_RE = /^[a-z][a-z0-9-]*$/
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024

export interface InstallResult {
  installPath: string | null
  cmd: string | null
  args: string[]
  env: Record<string, string>
}

export interface AcpArtifactDownloadCenter {
  execute: (request: DownloadRequest) => Promise<DownloadedArtifact>
  retry: (taskId: string, request: DownloadRequest) => Promise<DownloadedArtifact>
  release: (taskId: string) => Promise<unknown>
  findLatestRetryable: (
    owner: Pick<DownloadRequest['owner'], 'namespace' | 'resourceType' | 'resourceId'>,
    sourceId: string,
  ) => Pick<DownloadTaskView, 'taskId'> | null
}

export class AcpInstaller {
  getAgentInstallDir(rootDir: string, agentId: string): string {
    assertSafeAgentId(agentId)
    return join(rootDir, 'acp', 'agents', agentId)
  }

  async installBinaryAgent(
    agent: RegistryAgent,
    rootDir: string,
    downloadCenter: AcpArtifactDownloadCenter,
    signal?: AbortSignal,
  ): Promise<InstallResult> {
    const platformKey = getPlatformKey()
    const target = platformKey ? agent.distribution.binary?.[platformKey] : undefined
    if (!target) {
      throw new AppError({
        code: 'acp_distribution_not_supported',
        status: 409,
        message: 'Requested ACP distribution is not supported for this agent on the current platform',
        details: { agentId: agent.id, distributionType: 'binary' },
      })
    }
    const installDir = this.getAgentInstallDir(rootDir, agent.id)
    const owner = {
      namespace: 'acp',
      resourceType: 'agent',
      resourceId: agent.id,
      displayName: agent.name,
    }
    const sourceId = `acp:${agent.id}:${agent.version}:${platformKey}:${createHash('sha256').update(target.archive).digest('hex').slice(0, 16)}`
    const request: DownloadRequest = {
      owner,
      fileName: `acp-${agent.id}-${platformKey}${isZipArchive(target.archive) ? '.zip' : '.archive'}`,
      sources: [{ id: sourceId, url: target.archive }],
      integrity: target.sha256
        ? { checksum: { algorithm: 'sha256', value: target.sha256 } }
        : undefined,
      maxBytes: MAX_ARCHIVE_BYTES,
    }
    signal?.throwIfAborted()
    const retryable = downloadCenter.findLatestRetryable(owner, sourceId)
    const artifact = retryable
      ? await downloadCenter.retry(retryable.taskId, request)
      : await downloadCenter.execute(request)
    try {
      signal?.throwIfAborted()
      await fsp.rm(installDir, { recursive: true, force: true })
      await fsp.mkdir(installDir, { recursive: true })
      // Download Center has completed the transfer; ACP owns only extraction
      // and placement of the executable.
      if (isZipArchive(target.archive)) {
        await execFileAsync('unzip', ['-o', '-q', artifact.filePath, '-d', installDir])
      }
      else {
        await execFileAsync('tar', ['-xf', artifact.filePath, '-C', installDir])
      }
      const cmdPath = join(installDir, target.cmd.replace(/^\.[/\\]/, '').replaceAll('\\', '/'))
      await fsp.chmod(cmdPath, 0o755).catch(() => {})
      signal?.throwIfAborted()

      return {
        installPath: installDir,
        cmd: target.cmd,
        args: target.args,
        env: target.env,
      }
    }
    catch (error) {
      if (signal?.aborted) {
        await fsp.rm(installDir, { recursive: true, force: true })
      }
      throw error
    }
    finally {
      await downloadCenter.release(artifact.taskId).catch(() => {})
    }
  }

  installPackageAgent(agent: RegistryAgent, type: Extract<AcpDistributionType, 'npx' | 'uvx'>): InstallResult {
    const spec: PackageDistribution | undefined = type === 'npx' ? agent.distribution.npx : agent.distribution.uvx
    if (!spec) {
      throw new Error(`No ${type} distribution found for agent ${agent.id}`)
    }

    return {
      installPath: null,
      cmd: spec.package,
      args: spec.args,
      env: spec.env,
    }
  }

  async uninstallBinaryAgent(agentId: string, installPath: string, rootDir: string): Promise<void> {
    const expectedPrefix = join(rootDir, 'acp', 'agents') + sep
    const normalized = normalize(installPath)
    if (!normalized.startsWith(expectedPrefix)) {
      throw new Error(`Refusing to delete path outside of ${expectedPrefix}: ${installPath}`)
    }
    assertSafeAgentId(agentId)
    await fsp.rm(installPath, { recursive: true, force: true })
  }
}

function isZipArchive(archive: string): boolean {
  return new URL(archive).pathname.toLowerCase().endsWith('.zip')
}

function assertSafeAgentId(agentId: string): void {
  if (!AGENT_ID_RE.test(agentId)) {
    throw new Error(`Unsafe agent ID: ${JSON.stringify(agentId)}`)
  }
}
