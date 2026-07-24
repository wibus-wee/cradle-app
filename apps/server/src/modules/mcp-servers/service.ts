import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { McpServerConfig } from '@cradle/plugin-sdk/server'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { getServerConfig } from '../../infra'
import {
  clearCustomMcpServers,
  hasHostMcpServer,
  replaceCustomMcpServers,
} from '../../plugins/mcp-registry'
import * as Secrets from '../secrets/service'

const serverNameSchema = z.string().trim().min(1).max(64).regex(/^[\dA-Z][\w.-]*$/i)
const secretValuesSchema = z.record(z.string().min(1), z.string())
const storedServerSchema = z.discriminatedUnion('transport', [
  z.object({
    id: z.string().min(1),
    transport: z.literal('stdio'),
    name: serverNameSchema,
    enabled: z.boolean(),
    command: z.string().trim().min(1),
    args: z.array(z.string()),
    secretRef: z.string().min(1).nullable(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
  }),
  z.object({
    id: z.string().min(1),
    transport: z.literal('streamable-http'),
    name: serverNameSchema,
    enabled: z.boolean(),
    url: z.string().trim().url(),
    secretRef: z.string().min(1).nullable(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
  }),
])
const storeSchema = z.object({ version: z.literal(1), servers: z.array(storedServerSchema) })
const secretPayloadSchema = z.object({ values: secretValuesSchema })

type StoredServer = z.infer<typeof storedServerSchema>

export type SaveMcpServerInput
  = | { transport: 'stdio', name: string, enabled: boolean, command: string, args: string[], secretValues?: Record<string, string> }
    | { transport: 'streamable-http', name: string, enabled: boolean, url: string, secretValues?: Record<string, string> }

export interface CustomMcpServerSummary {
  id: string
  name: string
  transport: 'stdio' | 'streamable-http'
  enabled: boolean
  command?: string
  args?: string[]
  url?: string
  secretKeys: string[]
  status: 'ready' | 'disabled' | 'error'
  error?: string
  supportedRuntimes: string[]
  createdAt: number
  updatedAt: number
}

interface SecretStore {
  saveSecret: typeof Secrets.saveSecret
  upsertSecret: typeof Secrets.upsertSecret
  readSecret: typeof Secrets.readSecret
  removeSecret: typeof Secrets.removeSecret
}

interface RegistryProjection {
  clear: typeof clearCustomMcpServers
  hasHost: typeof hasHostMcpServer
  replace: typeof replaceCustomMcpServers
}

interface CustomMcpServerServiceOptions {
  filePath: string
  secrets: SecretStore
  registry: RegistryProjection
}

const ALL_NATIVE_RUNTIMES = ['codex', 'claude-agent', 'opencode', 'kimi', 'jar-core']
const STDIO_NATIVE_RUNTIMES = [...ALL_NATIVE_RUNTIMES, 'acp-chat']

export class CustomMcpServerService {
  private records: StoredServer[] = []
  private errors = new Map<string, string>()
  private secretKeys = new Map<string, string[]>()
  private hydrated = false
  private mutation = Promise.resolve()

  constructor(private readonly options: CustomMcpServerServiceOptions) {}

  async hydrate(): Promise<void> {
    if (!this.hydrated) {
      this.records = await this.readStore()
      this.hydrated = true
    }
    this.reconcileRegistry()
  }

  async list(): Promise<CustomMcpServerSummary[]> {
    await this.hydrate()
    return this.records.map(record => this.toSummary(record))
  }

  async create(input: SaveMcpServerInput): Promise<CustomMcpServerSummary> {
    return await this.runMutation(async () => {
      await this.hydrate()
      this.assertNameAvailable(input.name)
      const now = Math.floor(Date.now() / 1000)
      const secretRef = this.saveSecretValues(input.name, input.secretValues)
      const record = storedServerSchema.parse({
        ...input,
        id: randomUUID(),
        secretRef,
        createdAt: now,
        updatedAt: now,
      })
      const nextRecords = [...this.records, record]
      try {
        await this.writeStore(nextRecords)
      }
      catch (error) {
        if (secretRef) {
          this.options.secrets.removeSecret(secretRef)
        }
        throw error
      }
      this.records = nextRecords
      this.reconcileRegistry()
      return this.toSummary(record)
    })
  }

  async update(id: string, input: SaveMcpServerInput): Promise<CustomMcpServerSummary> {
    return await this.runMutation(async () => {
      await this.hydrate()
      const index = this.records.findIndex(record => record.id === id)
      const current = this.records[index]
      if (!current) {
        throw notFound(id)
      }
      this.assertNameAvailable(input.name, id)
      const replacingSecrets = input.secretValues !== undefined
      const previousSecret = replacingSecrets ? this.tryReadSecret(current.secretRef) : null
      const secretRef = input.secretValues === undefined
        ? current.secretRef
        : this.replaceSecretValues(current, input.name, input.secretValues)
      const next = storedServerSchema.parse({
        ...input,
        id: current.id,
        secretRef,
        createdAt: current.createdAt,
        updatedAt: Math.floor(Date.now() / 1000),
      })
      const nextRecords = this.records.with(index, next)
      try {
        await this.writeStore(nextRecords)
      }
      catch (error) {
        if (replacingSecrets) {
          this.restoreSecretValues(current, previousSecret, secretRef)
        }
        throw error
      }
      this.records = nextRecords
      this.reconcileRegistry()
      return this.toSummary(next)
    })
  }

  async setEnabled(id: string, enabled: boolean): Promise<CustomMcpServerSummary> {
    return await this.runMutation(async () => {
      await this.hydrate()
      const index = this.records.findIndex(record => record.id === id)
      const current = this.records[index]
      if (!current) {
        throw notFound(id)
      }
      const next = storedServerSchema.parse({
        ...current,
        enabled,
        updatedAt: Math.floor(Date.now() / 1000),
      })
      const nextRecords = this.records.with(index, next)
      await this.writeStore(nextRecords)
      this.records = nextRecords
      this.reconcileRegistry()
      return this.toSummary(next)
    })
  }

  async remove(id: string): Promise<void> {
    await this.runMutation(async () => {
      await this.hydrate()
      const index = this.records.findIndex(record => record.id === id)
      const record = this.records[index]
      if (!record) {
        throw notFound(id)
      }
      const nextRecords = this.records.toSpliced(index, 1)
      await this.writeStore(nextRecords)
      this.records = nextRecords
      this.reconcileRegistry()
      if (record.secretRef) {
        this.options.secrets.removeSecret(record.secretRef)
      }
    })
  }

  reset(): void {
    this.records = []
    this.errors.clear()
    this.secretKeys.clear()
    this.hydrated = false
    this.options.registry.clear()
  }

  private async runMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(operation, operation)
    this.mutation = result.then(() => undefined, () => undefined)
    return await result
  }

  private async readStore(): Promise<StoredServer[]> {
    try {
      return storeSchema.parse(JSON.parse(await readFile(this.options.filePath, 'utf8'))).servers
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return []
      }
      throw error
    }
  }

  private async writeStore(records: StoredServer[]): Promise<void> {
    await mkdir(dirname(this.options.filePath), { recursive: true, mode: 0o700 })
    const temporaryPath = `${this.options.filePath}.${randomUUID()}.tmp`
    await writeFile(
      temporaryPath,
      JSON.stringify({ version: 1, servers: records }, null, 2),
      { encoding: 'utf8', mode: 0o600 },
    )
    try {
      await rename(temporaryPath, this.options.filePath)
    }
    finally {
      await rm(temporaryPath, { force: true })
    }
  }

  private reconcileRegistry(): void {
    const projected: McpServerConfig[] = []
    this.errors.clear()
    this.secretKeys.clear()
    for (const record of this.records) {
      try {
        const values = this.readSecretValues(record)
        this.secretKeys.set(record.id, Object.keys(values).sort())
        if (!record.enabled) {
          continue
        }
        if (this.options.registry.hasHost(record.name)) {
          this.errors.set(record.id, `MCP server name is already registered by Cradle or a plugin: ${record.name}`)
          continue
        }
        projected.push(record.transport === 'stdio'
          ? {
              transport: 'stdio',
              name: record.name,
              command: record.command,
              args: record.args,
              env: values,
            }
          : {
              transport: 'streamable-http',
              name: record.name,
              url: record.url,
              headers: values,
            })
      }
      catch (error) {
        this.errors.set(record.id, error instanceof Error ? error.message : String(error))
      }
    }
    this.options.registry.replace(projected)
  }

  private readSecretValues(record: StoredServer): Record<string, string> {
    if (!record.secretRef) {
      return {}
    }
    return secretPayloadSchema.parse(JSON.parse(this.options.secrets.readSecret(record.secretRef))).values
  }

  private saveSecretValues(name: string, values: Record<string, string> | undefined): string | null {
    if (!values || Object.keys(values).length === 0) {
      return null
    }
    return this.options.secrets.saveSecret({
      kind: 'mcp-server',
      label: `MCP server: ${name}`,
      secret: JSON.stringify({ values: secretValuesSchema.parse(values) }),
    }).id
  }

  private replaceSecretValues(
    record: StoredServer,
    name: string,
    values: Record<string, string>,
  ): string | null {
    if (Object.keys(values).length === 0) {
      if (record.secretRef) {
        this.options.secrets.removeSecret(record.secretRef)
      }
      return null
    }
    const secret = JSON.stringify({ values: secretValuesSchema.parse(values) })
    if (record.secretRef) {
      this.options.secrets.upsertSecret({
        id: record.secretRef,
        kind: 'mcp-server',
        label: `MCP server: ${name}`,
        secret,
      })
      return record.secretRef
    }
    return this.options.secrets.saveSecret({
      kind: 'mcp-server',
      label: `MCP server: ${name}`,
      secret,
    }).id
  }

  private restoreSecretValues(
    record: StoredServer,
    previousSecret: string | null | undefined,
    nextSecretRef: string | null,
  ): void {
    if (record.secretRef) {
      if (previousSecret !== null && previousSecret !== undefined) {
        this.options.secrets.upsertSecret({
          id: record.secretRef,
          kind: 'mcp-server',
          label: `MCP server: ${record.name}`,
          secret: previousSecret,
        })
      }
      else if (nextSecretRef === record.secretRef) {
        this.options.secrets.removeSecret(record.secretRef)
      }
      return
    }
    if (nextSecretRef) {
      this.options.secrets.removeSecret(nextSecretRef)
    }
  }

  private tryReadSecret(secretRef: string | null): string | null | undefined {
    if (!secretRef) {
      return null
    }
    try {
      return this.options.secrets.readSecret(secretRef)
    }
    catch {
      return undefined
    }
  }

  private assertNameAvailable(name: string, currentId?: string): void {
    const normalized = serverNameSchema.parse(name)
    const duplicate = this.records.find(record => record.name === normalized && record.id !== currentId)
    if (duplicate || this.options.registry.hasHost(normalized)) {
      throw new AppError({
        code: 'mcp_server_name_conflict',
        status: 409,
        message: `MCP server name is already in use: ${normalized}`,
      })
    }
  }

  private toSummary(record: StoredServer): CustomMcpServerSummary {
    const error = this.errors.get(record.id)
    return {
      id: record.id,
      name: record.name,
      transport: record.transport,
      enabled: record.enabled,
      ...(record.transport === 'stdio'
        ? { command: record.command, args: [...record.args] }
        : { url: record.url }),
      secretKeys: this.secretKeys.get(record.id) ?? [],
      status: !record.enabled ? 'disabled' : error ? 'error' : 'ready',
      ...(error ? { error } : {}),
      supportedRuntimes: record.transport === 'stdio'
        ? [...STDIO_NATIVE_RUNTIMES]
        : [...ALL_NATIVE_RUNTIMES],
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }
  }
}

function notFound(id: string): AppError {
  return new AppError({
    code: 'mcp_server_not_found',
    status: 404,
    message: 'MCP server not found',
    details: { id },
  })
}

function resolveStorePath(): string {
  const config = getServerConfig()
  return join(config.dataDir ?? dirname(config.dbPath), 'mcp-servers', 'servers.json')
}

let singleton: CustomMcpServerService | null = null
let singletonPath: string | null = null

export function getCustomMcpServerService(): CustomMcpServerService {
  const filePath = resolveStorePath()
  if (!singleton || singletonPath !== filePath) {
    singleton = new CustomMcpServerService({
      filePath,
      secrets: Secrets,
      registry: {
        clear: clearCustomMcpServers,
        hasHost: hasHostMcpServer,
        replace: replaceCustomMcpServers,
      },
    })
    singletonPath = filePath
  }
  return singleton
}

export async function hydrateCustomMcpServers(): Promise<void> {
  await getCustomMcpServerService().hydrate()
}

export function resetCustomMcpServerService(): void {
  singleton?.reset()
  singleton = null
  singletonPath = null
}
