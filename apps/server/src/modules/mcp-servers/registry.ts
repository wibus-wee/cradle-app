import { kvCache } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'

const REGISTRY_BASE_URL = 'https://registry.modelcontextprotocol.io/v0.1/servers'
const REGISTRY_TIMEOUT_MS = 10_000
const CACHE_TTL_SECONDS = 5 * 60
const PAGE_LIMIT = 50
const CACHE_KEY_PREFIX = 'mcp-registry:servers:'

const registryArgumentSchema = z.object({
  type: z.string().optional(),
  name: z.string().optional(),
  value: z.string().optional(),
}).loose()

const registryPackageSchema = z.object({
  registryType: z.string(),
  identifier: z.string().min(1),
  version: z.string().optional(),
  runtimeHint: z.string().optional(),
  runtimeArguments: z.array(registryArgumentSchema).optional(),
  packageArguments: z.array(registryArgumentSchema).optional(),
  environmentVariables: z.array(z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    required: z.boolean().optional(),
  }).loose()).optional(),
}).loose()

const registryRemoteSchema = z.object({
  type: z.string(),
  url: z.string().min(1),
}).loose()

const registryServerSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  version: z.string().optional(),
  remotes: z.array(registryRemoteSchema).optional(),
  packages: z.array(registryPackageSchema).optional(),
}).loose()

const registryEntrySchema = z.object({
  server: registryServerSchema,
  _meta: z.object({
    'io.modelcontextprotocol.registry/official': z.object({
      status: z.string().optional(),
      isLatest: z.boolean().optional(),
      publishedAt: z.string().optional(),
    }).loose().optional(),
  }).loose().optional(),
}).loose()

const registryListResponseSchema = z.object({
  servers: z.array(registryEntrySchema),
  metadata: z.object({ nextCursor: z.string().optional() }).loose().optional(),
}).loose()

export interface RegistryInstallHintStdio {
  transport: 'stdio'
  command: string
  args: string[]
}

export interface RegistryInstallHintHttp {
  transport: 'streamable-http'
  url: string
}

export type RegistryInstallHint = RegistryInstallHintStdio | RegistryInstallHintHttp

export interface RegistryCandidate {
  name: string
  title: string | null
  description: string | null
  version: string | null
  publishedAt: string | null
  packageRegistry: 'npm' | 'pypi' | 'oci' | null
  env: { name: string, description: string | null, required: boolean }[]
  installHint: RegistryInstallHint | null
}

export interface RegistryPage {
  servers: RegistryCandidate[]
  nextCursor: string | null
}

type FetchLike = typeof fetch

export interface RegistryCacheStore {
  read: (key: string) => { value: string, expiresAt: number } | null
  write: (key: string, value: string, expiresAt: number) => void
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function createKvCacheStore(): RegistryCacheStore {
  return {
    read: (key) => {
      try {
        const row = db().select().from(kvCache).where(eq(kvCache.key, key)).get()
        return row ?? null
      }
      catch {
        return null
      }
    },
    write: (key, value, expiresAt) => {
      try {
        db().insert(kvCache).values({ key, value, expiresAt }).onConflictDoUpdate({ target: kvCache.key, set: { value, expiresAt } }).run()
      }
      catch {
        // non-critical, ignore
      }
    },
  }
}

function toPage(payload: unknown): RegistryPage | null {
  const parsed = registryListResponseSchema.safeParse(payload)
  if (!parsed.success) { return null }
  return {
    servers: parsed.data.servers
      .map(toCandidate)
      .filter((candidate): candidate is RegistryCandidate => candidate !== null),
    nextCursor: parsed.data.metadata?.nextCursor ?? null,
  }
}

export class McpRegistryService {
  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly cache: RegistryCacheStore = createKvCacheStore(),
  ) {}

  async search(options: { search?: string, cursor?: string }): Promise<RegistryPage> {
    const search = options.search?.trim() ?? ''
    const cursor = options.cursor?.trim() ?? ''
    const cacheKey = `${CACHE_KEY_PREFIX}${JSON.stringify([search, cursor])}`
    const cached = this.cache.read(cacheKey)
    if (cached && cached.expiresAt > nowSeconds()) {
      const page = toPage(JSON.parse(cached.value))
      if (page) { return page }
    }

    try {
      const payload = await this.fetchUpstream(search, cursor)
      const page = toPage(payload)
      if (!page) { throw new Error('unexpected registry payload') }
      this.cache.write(cacheKey, JSON.stringify(payload), nowSeconds() + CACHE_TTL_SECONDS)
      return page
    }
    catch (error) {
      // Fall back to a stale cached page rather than failing the whole browse.
      if (cached) {
        const page = toPage(JSON.parse(cached.value))
        if (page) { return page }
      }
      if (error instanceof AppError) { throw error }
      throw new AppError({
        code: 'mcp_registry_unavailable',
        status: 502,
        message: 'The MCP registry is unavailable',
        details: { reason: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  private async fetchUpstream(search: string, cursor: string): Promise<unknown> {
    const url = new URL(REGISTRY_BASE_URL)
    url.searchParams.set('limit', String(PAGE_LIMIT))
    if (search) { url.searchParams.set('search', search) }
    if (cursor) { url.searchParams.set('cursor', cursor) }

    try {
      const response = await this.fetchImpl(url, {
        signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      })
      if (!response.ok) { throw new Error(`registry responded ${response.status}`) }
      return await response.json()
    }
    catch (error) {
      throw new AppError({
        code: 'mcp_registry_unavailable',
        status: 502,
        message: 'The MCP registry is unavailable',
        details: { reason: error instanceof Error ? error.message : String(error) },
      })
    }
  }
}

let singleton: McpRegistryService | null = null

export function getMcpRegistryService(): McpRegistryService {
  singleton ??= new McpRegistryService()
  return singleton
}

function collectPackageArgs(pkg: z.infer<typeof registryPackageSchema>): string[] {
  // Only literal values are safe to prefill; templated `{variable}` args need
  // user input we cannot guess, so they are skipped.
  const args = [...(pkg.runtimeArguments ?? []), ...(pkg.packageArguments ?? [])]
  return args
    .map(arg => arg.value)
    .filter((value): value is string => typeof value === 'string' && !value.includes('{'))
}

function toCandidate(entry: z.infer<typeof registryEntrySchema>): RegistryCandidate | null {
  const official = entry._meta?.['io.modelcontextprotocol.registry/official']
  if (official?.status !== undefined && official.status !== 'active') { return null }
  if (official?.isLatest === false) { return null }
  const server = entry.server

  const httpRemote = server.remotes?.find(remote => remote.type === 'streamable-http')
  if (httpRemote) {
    return {
      name: server.name,
      title: server.title ?? null,
      description: server.description ?? null,
      version: server.version ?? null,
      publishedAt: official?.publishedAt ?? null,
      packageRegistry: null,
      env: [],
      installHint: { transport: 'streamable-http', url: httpRemote.url },
    }
  }

  const pkg = server.packages?.find(candidate => ['npm', 'pypi', 'oci'].includes(candidate.registryType))
  if (!pkg) {
    return {
      name: server.name,
      title: server.title ?? null,
      description: server.description ?? null,
      version: server.version ?? null,
      publishedAt: official?.publishedAt ?? null,
      packageRegistry: null,
      env: [],
      installHint: null,
    }
  }

  const extraArgs = collectPackageArgs(pkg)
  const commandByRegistry = { npm: 'npx', pypi: 'uvx', oci: 'docker' } as const
  const argsByRegistry: Record<keyof typeof commandByRegistry, string[]> = {
    npm: ['-y', pkg.identifier, ...extraArgs],
    pypi: [pkg.identifier, ...extraArgs],
    oci: ['run', '-i', '--rm', pkg.identifier, ...extraArgs],
  }
  const packageRegistry = pkg.registryType as keyof typeof commandByRegistry

  return {
    name: server.name,
    title: server.title ?? null,
    description: server.description ?? null,
    version: server.version ?? null,
    publishedAt: official?.publishedAt ?? null,
    packageRegistry,
    env: (pkg.environmentVariables ?? []).map(variable => ({
      name: variable.name,
      description: variable.description ?? null,
      required: variable.required ?? false,
    })),
    installHint: {
      transport: 'stdio',
      command: commandByRegistry[packageRegistry],
      args: argsByRegistry[packageRegistry],
    },
  }
}
