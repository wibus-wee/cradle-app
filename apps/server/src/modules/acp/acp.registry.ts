import { z } from 'zod'

export const ACP_REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json'

export interface BinaryTarget {
  archive: string
  cmd: string
  args: string[]
  env: Record<string, string>
  sha256?: string
}

export interface PackageDistribution {
  package: string
  args: string[]
  env: Record<string, string>
}

export type PlatformKey = 'darwin-aarch64' | 'darwin-x86_64' | 'linux-aarch64' | 'linux-x86_64' | 'windows-aarch64' | 'windows-x86_64'
export type AcpDistributionType = 'binary' | 'npx' | 'uvx'

export interface RegistryAgentDistribution {
  binary?: Partial<Record<PlatformKey, BinaryTarget>>
  npx?: PackageDistribution
  uvx?: PackageDistribution
}

export interface RegistryAgent {
  id: string
  name: string
  version: string
  description: string
  repository?: string
  website?: string
  authors?: string[]
  license?: string
  icon?: string
  distribution: RegistryAgentDistribution
}

const BinaryTargetSchema = z.object({
  archive: z.string(),
  cmd: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  sha256: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
})

const PackageDistributionSchema = z.object({
  package: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
})

const RegistryAgentDistributionSchema = z.object({
  binary: z.object({
    'darwin-aarch64': BinaryTargetSchema.optional(),
    'darwin-x86_64': BinaryTargetSchema.optional(),
    'linux-aarch64': BinaryTargetSchema.optional(),
    'linux-x86_64': BinaryTargetSchema.optional(),
    'windows-aarch64': BinaryTargetSchema.optional(),
    'windows-x86_64': BinaryTargetSchema.optional(),
  }).optional(),
  npx: PackageDistributionSchema.optional(),
  uvx: PackageDistributionSchema.optional(),
})

const RegistryAgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  repository: z.string().optional(),
  website: z.string().optional(),
  authors: z.array(z.string()).optional(),
  license: z.string().optional(),
  icon: z.string().optional(),
  distribution: RegistryAgentDistributionSchema,
})

const RegistryPayloadSchema = z.object({
  version: z.string(),
  agents: z.array(RegistryAgentSchema),
})

const PLATFORM_MAP: Partial<Record<string, PlatformKey>> = {
  'darwin-arm64': 'darwin-aarch64',
  'darwin-x64': 'darwin-x86_64',
  'linux-arm64': 'linux-aarch64',
  'linux-x64': 'linux-x86_64',
  'win32-arm64': 'windows-aarch64',
  'win32-x64': 'windows-x86_64',
}

export class AcpRegistry {
  // Resolve fetch at call time so test spies on globalThis.fetch are honored.
  // Capturing `fetch` in the constructor default would freeze the pre-spy value
  // for the module-scoped registry used by the ACP service.
  constructor(private readonly fetchFn?: typeof fetch) {}

  private resolveFetch(): typeof fetch {
    return this.fetchFn ?? globalThis.fetch.bind(globalThis)
  }

  async fetchRegistry(): Promise<RegistryAgent[]> {
    const response = await this.resolveFetch()(ACP_REGISTRY_URL)
    if (!response.ok) {
      throw new Error(`ACP registry fetch failed with HTTP ${response.status}`)
    }

    const payload = RegistryPayloadSchema.parse(await response.json())
    return payload.agents
  }

  getSupportedDistributionTypes(agent: RegistryAgent): AcpDistributionType[] {
    const out: AcpDistributionType[] = []
    if (agent.distribution.npx) {
      out.push('npx')
    }
    if (agent.distribution.uvx) {
      out.push('uvx')
    }
    const platformKey = getPlatformKey()
    const binaryTarget = platformKey ? agent.distribution.binary?.[platformKey] : undefined
    if (binaryTarget) {
      out.push('binary')
    }
    return out
  }
}

export function getPlatformKey(): PlatformKey | null {
  return PLATFORM_MAP[`${process.platform}-${process.arch}`] ?? null
}
