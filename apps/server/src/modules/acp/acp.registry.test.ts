import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { AcpInstaller } from './acp.installer'
import type { RegistryAgent } from './acp.registry'
import { ACP_REGISTRY_URL, AcpRegistry } from './acp.registry'

const binaryAgent: RegistryAgent = {
  id: 'example-agent',
  name: 'Example Agent',
  version: '1.0.0',
  description: 'Example',
  distribution: {
    binary: {
      'darwin-aarch64': {
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

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('aCP registry integrity policy', () => {
  it('uses the injected fetch boundary and does not advertise checksum-less binaries', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      version: '1',
      agents: [binaryAgent],
    })))
    const registry = new AcpRegistry(fetchFn)

    const agents = await registry.fetchRegistry()

    expect(fetchFn).toHaveBeenCalledWith(ACP_REGISTRY_URL)
    expect(registry.getSupportedDistributionTypes(agents[0])).toEqual(['npx', 'uvx'])
  })

  it('rejects binary installation before creating an install directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cradle-acp-integrity-'))
    tempRoots.push(root)
    const installer = new AcpInstaller()

    const install = installer.installBinaryAgent(binaryAgent, root)

    await expect(install).rejects.toMatchObject({
      code: 'acp_binary_integrity_metadata_missing',
      status: 409,
      message: 'ACP binary installation requires a trusted publisher checksum, but the registry does not provide one',
    })
  })

  it.each([
    ['npx', { installPath: null, cmd: '@example/agent', args: ['--stdio'], env: { EXAMPLE_MODE: 'npx' } }],
    ['uvx', { installPath: null, cmd: 'example-agent', args: ['serve'], env: { EXAMPLE_MODE: 'uvx' } }],
  ] as const)('keeps the %s package distribution unchanged', (type, expected) => {
    const installer = new AcpInstaller()

    expect(installer.installPackageAgent(binaryAgent, type)).toEqual(expected)
  })
})
