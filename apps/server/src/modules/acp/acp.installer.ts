import { createWriteStream, promises as fsp } from 'node:fs'
import { isAbsolute, join, normalize, sep } from 'node:path'

import extractZip from 'extract-zip'
import * as tar from 'tar'

import type { AcpDistributionType, PackageDistribution, RegistryAgent } from './acp.registry'
import { getPlatformKey } from './acp.registry'

const AGENT_ID_RE = /^[a-z][a-z0-9-]*$/

export interface InstallResult {
  installPath: string | null
  cmd: string | null
  args: string[]
  env: Record<string, string>
}

export class AcpInstaller {
  getAgentInstallDir(rootDir: string, agentId: string): string {
    assertSafeAgentId(agentId)
    return join(rootDir, 'acp', 'agents', agentId)
  }

  async installBinaryAgent(
    agent: RegistryAgent,
    rootDir: string,
    signal?: AbortSignal,
  ): Promise<InstallResult> {
    const platformKey = getPlatformKey()
    if (!platformKey) {
      throw new Error('Unsupported platform for binary distribution')
    }

    const target = agent.distribution.binary?.[platformKey]
    if (!target) {
      throw new Error(`No binary distribution for platform ${platformKey} in agent ${agent.id}`)
    }

    assertSafeCmd(target.cmd)

    const installDir = this.getAgentInstallDir(rootDir, agent.id)
    const tempDir = join(rootDir, 'acp', 'tmp')
    await fsp.mkdir(installDir, { recursive: true })
    await fsp.mkdir(tempDir, { recursive: true })

    const ext = archiveExtension(target.archive)
    const tempFile = join(tempDir, `${agent.id}-${Date.now()}${ext}`)

    try {
      await downloadFile(target.archive, tempFile, signal)
      if (signal?.aborted) {
        throw new DOMException('Install cancelled', 'AbortError')
      }
      await extractArchive(tempFile, installDir, ext)
      if (process.platform !== 'win32') {
        await fsp.chmod(join(installDir, target.cmd), 0o755)
      }
    }
    finally {
      await fsp.rm(tempFile, { force: true })
    }

    return {
      installPath: installDir,
      cmd: target.cmd,
      args: target.args,
      env: target.env,
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

function assertSafeAgentId(agentId: string): void {
  if (!AGENT_ID_RE.test(agentId)) {
    throw new Error(`Unsafe agent ID: ${JSON.stringify(agentId)}`)
  }
}

function assertSafeCmd(cmd: string): void {
  if (isAbsolute(cmd) || normalize(cmd).includes('..')) {
    throw new Error(`Unsafe cmd path: ${JSON.stringify(cmd)}`)
  }
}

function resolveExtractedPath(destDir: string, entryPath: string): string {
  const resolved = join(destDir, entryPath)
  const prefix = normalize(destDir) + sep
  if (!resolved.startsWith(prefix) && resolved !== normalize(destDir)) {
    throw new Error(`Path traversal detected in archive entry: ${entryPath}`)
  }
  return resolved
}

function archiveExtension(url: string): string {
  const lower = url.split('?')[0].toLowerCase()
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    return '.tar.gz'
  }
  if (lower.endsWith('.tar.bz2') || lower.endsWith('.tbz2')) {
    return '.tar.bz2'
  }
  if (lower.endsWith('.zip')) {
    return '.zip'
  }
  throw new Error(`Unsupported archive extension for URL: ${url}`)
}

async function extractArchive(archivePath: string, destDir: string, ext: string): Promise<void> {
  if (ext === '.zip') {
    await extractZip(archivePath, {
      dir: destDir,
      onEntry(entry) {
        resolveExtractedPath(destDir, entry.fileName)
      },
    })
    return
  }

  await tar.extract({
    file: archivePath,
    cwd: destDir,
    filter(entryPath) {
      try {
        resolveExtractedPath(destDir, entryPath)
        return true
      }
      catch {
        return false
      }
    },
  })
}

async function downloadFile(url: string, destPath: string, signal?: AbortSignal): Promise<void> {
  if (!url.startsWith('https://')) {
    throw new Error(`Only HTTPS download URLs are accepted, got: ${url}`)
  }

  const response = await fetch(url, { signal })
  if (!response.ok || !response.body) {
    throw new Error(`Download of ${url} failed with HTTP ${response.status}`)
  }

  await new Promise<void>((resolve, reject) => {
    const file = createWriteStream(destPath)
    const reader = response.body!.getReader()

    const pump = async (): Promise<void> => {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            file.end(() => resolve())
            return
          }
          file.write(Buffer.from(value))
        }
      }
      catch (error) {
        file.destroy()
        reject(error)
      }
    }

    void pump()
  })
}
