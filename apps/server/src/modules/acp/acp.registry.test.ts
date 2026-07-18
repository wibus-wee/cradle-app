import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AcpArtifactDownloadCenter } from './acp.installer'
import { AcpInstaller } from './acp.installer'
import type { RegistryAgent } from './acp.registry'
import { ACP_REGISTRY_URL, AcpRegistry, getPlatformKey } from './acp.registry'

const testPlatform = getPlatformKey() ?? 'darwin-aarch64'

const binaryAgent: RegistryAgent = {
  id: 'example-agent',
  name: 'Example Agent',
  version: '1.0.0',
  description: 'Example',
  distribution: {
    binary: {
      [testPlatform]: {
        archive: 'https://downloads.example.com/agent.zip',
        cmd: 'agent',
        args: [],
        env: {},
      },
    },
    npx: {
      package: '@example/agent',
      args: ['--stdio'],
      env: { EXAMPLE_MODE: 'npx' },
    },
    uvx: {
      package: 'example-agent',
      args: ['serve'],
      env: { EXAMPLE_MODE: 'uvx' },
    },
  },
}

const tempRoots: string[] = []

function fakeDownloadCenter(): AcpArtifactDownloadCenter {
  return {
    execute: vi.fn(),
    retry: vi.fn(),
    release: vi.fn(async () => undefined),
    findLatestRetryable: vi.fn(() => null),
  }
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('aCP registry distributions', () => {
  it('uses the injected fetch boundary and advertises checksum-less binaries', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      version: '1',
      agents: [binaryAgent],
    })))
    const registry = new AcpRegistry(fetchFn)

    const agents = await registry.fetchRegistry()

    expect(fetchFn).toHaveBeenCalledWith(ACP_REGISTRY_URL)
    expect(registry.getSupportedDistributionTypes(agents[0])).toEqual(['npx', 'uvx', 'binary'])
  })

  it.each([
    ['npx', { installPath: null, cmd: '@example/agent', args: ['--stdio'], env: { EXAMPLE_MODE: 'npx' } }],
    ['uvx', { installPath: null, cmd: 'example-agent', args: ['serve'], env: { EXAMPLE_MODE: 'uvx' } }],
  ] as const)('keeps the %s package distribution unchanged', (type, expected) => {
    const installer = new AcpInstaller()

    expect(installer.installPackageAgent(binaryAgent, type)).toEqual(expected)
  })

  it('delegates checksum-less binary archive transfers and cleanup to Download Center', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cradle-acp-download-center-'))
    tempRoots.push(root)
    const downloadCenter = fakeDownloadCenter()
    const artifact = {
      taskId: 'download-task',
      filePath: join(root, 'missing.zip'),
      bytes: 1,
      checksum: {
        algorithm: 'sha256' as const,
        expected: null,
        actual: 'a'.repeat(64),
        matched: null,
      },
    }
    vi.mocked(downloadCenter.execute).mockResolvedValue(artifact)
    await expect(new AcpInstaller().installBinaryAgent(binaryAgent, root, downloadCenter)).rejects.toThrow()

    expect(downloadCenter.execute).toHaveBeenCalledWith(expect.objectContaining({
      owner: {
        namespace: 'acp',
        resourceType: 'agent',
        resourceId: 'example-agent',
        displayName: 'Example Agent',
      },
      integrity: undefined,
      maxBytes: 512 * 1024 * 1024,
    }))
    expect(downloadCenter.release).toHaveBeenCalledWith('download-task')
  })
})
