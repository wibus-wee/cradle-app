import type {
  Agent as OpenCodeAgent,
  Config,
  ProviderListResponse,
} from '@opencode-ai/sdk'

import type { ManagedChildProcess } from '../../../infra/managed-process'
import { spawnManagedProcess } from '../../../infra/managed-process'
import type {
  RuntimeKind,
  RuntimeModelCapabilities,
  RuntimeModelCatalog,
  RuntimeModelDescriptor,
} from '../../chat-runtime/runtime-provider-types'
import type { ProviderKind } from '../../provider-contracts/types'
import {
  OPENCODE_RUNTIME_NATIVE_PROVIDER_TARGET_ID,
  readOpenCodeRuntimeNativeProviderId,
  toOpenCodeRuntimeNativeProviderTargetId,
} from './native-provider-target-id'
import {
  acquireOpencodeRuntimeResource,
  resolveOpencodeRuntimeHostOptions,
} from './runtime-context'

export {
  isOpenCodeRuntimeNativeProviderTargetId,
  OPENCODE_RUNTIME_NATIVE_PROVIDER_TARGET_ID,
  OPENCODE_RUNTIME_NATIVE_PROVIDER_TARGET_PREFIX,
  readOpenCodeRuntimeNativeProviderId,
  toOpenCodeRuntimeNativeProviderTargetId,
} from './native-provider-target-id'

const OPENCODE_MODEL_CATALOG_SCOPE_ID = 'model-catalog'
const DEFAULT_CLI_TIMEOUT_MS = 10_000

type OpenCodeProvider = ProviderListResponse['all'][number]
type OpenCodeModel = OpenCodeProvider['models'][string]
type OpenCodeReasoningEffort = NonNullable<RuntimeModelDescriptor['capabilities']['reasoningEfforts']>[number]

interface OpenCodeVariantConfig {
  reasoningEffort?: string
  reasoning_effort?: string
  effort?: string
  thinking?: unknown
  thinkingConfig?: {
    thinkingLevel?: string
    thinking_level?: string
  }
  thinking_config?: {
    thinkingLevel?: string
    thinking_level?: string
  }
  reasoning?: {
    effort?: string
  }
  reasoningConfig?: {
    maxReasoningEffort?: string
    max_reasoning_effort?: string
  }
  reasoning_config?: {
    maxReasoningEffort?: string
    max_reasoning_effort?: string
  }
}

const OPENCODE_REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const satisfies readonly OpenCodeReasoningEffort[]

export interface OpencodeRuntimeProviderGroup {
  id: string
  nativeProviderId: string
  label: string
  providerKind: ProviderKind
  modelCount: number
}

export interface OpencodeRuntimeAgentDescriptor {
  id: string
  label: string
  description: string | null
  mode: OpenCodeAgent['mode']
  builtIn: boolean
  modelId: string | null
}

export interface OpenCodeCliModelDescriptor {
  slug: string
  providerId: string
  modelId: string
  label: string
  capabilities: RuntimeModelCapabilities
}

export interface OpencodeCommandResult {
  stdout: string
  stderr: string
  code: number
}

interface OpenCodeDiscoveryResult {
  catalog: RuntimeModelCatalog
  providerLabels: Map<string, string>
}

interface OpenCodeModelDiscoveryDependencies {
  acquireRuntimeResource: typeof acquireOpencodeRuntimeResource
  listCliModels: (input: { binaryPath: string, cwd: string }) => Promise<OpenCodeCliModelDescriptor[]>
  now: () => number
}

const defaultDiscoveryDependencies: OpenCodeModelDiscoveryDependencies = {
  acquireRuntimeResource: acquireOpencodeRuntimeResource,
  listCliModels: input => listOpencodeCliModels(input),
  now: currentUnixSeconds,
}

export async function listOpencodeRuntimeModels(input: {
  runtimeKind: RuntimeKind
  workspacePath?: string
}, dependencies: Partial<OpenCodeModelDiscoveryDependencies> = {}): Promise<RuntimeModelCatalog> {
  return (await discoverOpenCodeModels(input, dependencies)).catalog
}

export async function listOpencodeRuntimeProviderGroups(input: {
  runtimeKind: RuntimeKind
  workspacePath?: string
}, dependencies: Partial<OpenCodeModelDiscoveryDependencies> = {}): Promise<OpencodeRuntimeProviderGroup[]> {
  const discovery = await discoverOpenCodeModels(input, dependencies)
  const groups = new Map<string, OpencodeRuntimeProviderGroup>()
  for (const model of discovery.catalog.models) {
    const nativeProviderId = model.nativeProviderId
    if (!nativeProviderId) {
      continue
    }
    const existing = groups.get(nativeProviderId)
    if (existing) {
      existing.modelCount += 1
      continue
    }
    groups.set(nativeProviderId, {
      id: toOpenCodeRuntimeNativeProviderTargetId(nativeProviderId),
      nativeProviderId,
      label: discovery.providerLabels.get(nativeProviderId) ?? nativeProviderId,
      providerKind: model.providerKind,
      modelCount: 1,
    })
  }
  return Array.from(groups.values()).sort((left, right) => left.label.localeCompare(right.label))
}

export async function listOpencodeRuntimeAgents(input: {
  runtimeKind: RuntimeKind
  workspacePath?: string
}): Promise<OpencodeRuntimeAgentDescriptor[]> {
  const lease = await acquireOpencodeRuntimeResource({
    runtimeKind: input.runtimeKind,
    providerTargetId: OPENCODE_RUNTIME_NATIVE_PROVIDER_TARGET_ID,
    chatSessionId: OPENCODE_MODEL_CATALOG_SCOPE_ID,
    config: {} satisfies Config,
    directory: input.workspacePath,
  })
  try {
    const result = await lease.resource.client.app.agents({
      ...(input.workspacePath ? { query: { directory: input.workspacePath } } : {}),
    })
    if (result.error) {
      throw result.error
    }
    if (!result.data) {
      throw new Error('OpenCode agent list returned no data.')
    }
    return result.data.map(agent => ({
      id: agent.name,
      label: agent.name,
      description: agent.description ?? null,
      mode: agent.mode,
      builtIn: agent.builtIn,
      modelId: agent.model ? toOpenCodeModelRef(agent.model.providerID, agent.model.modelID) : null,
    })).sort((left, right) => left.label.localeCompare(right.label))
  }
  finally {
    lease.release()
  }
}

export async function listOpencodeRuntimeModelsForProviderTarget(input: {
  runtimeKind: RuntimeKind
  providerTargetId: string
  workspacePath?: string
}, dependencies: Partial<OpenCodeModelDiscoveryDependencies> = {}): Promise<RuntimeModelDescriptor[]> {
  const nativeProviderId = readOpenCodeRuntimeNativeProviderId(input.providerTargetId)
  if (!nativeProviderId) {
    return []
  }
  const catalog = await listOpencodeRuntimeModels(input, dependencies)
  return catalog.models.filter(model => model.nativeProviderId === nativeProviderId)
}

async function discoverOpenCodeModels(
  input: {
    runtimeKind: RuntimeKind
    workspacePath?: string
  },
  dependencyOverrides: Partial<OpenCodeModelDiscoveryDependencies>,
): Promise<OpenCodeDiscoveryResult> {
  const dependencies = { ...defaultDiscoveryDependencies, ...dependencyOverrides }
  const hostOptions = resolveOpencodeRuntimeHostOptions({ directory: input.workspacePath })
  const [sdkResult, cliResult] = await Promise.allSettled([
    listOpenCodeProviderInventory({
      runtimeKind: input.runtimeKind,
      workspacePath: input.workspacePath,
      binaryPath: hostOptions.binaryPath,
    }, dependencies.acquireRuntimeResource),
    dependencies.listCliModels(hostOptions),
  ])

  if (sdkResult.status === 'fulfilled') {
    const connectedProviders = filterConnectedOpenCodeProviders(sdkResult.value)
    const sdkModels = flattenOpenCodeProviders({
      runtimeKind: input.runtimeKind,
      providers: connectedProviders,
    })
    const providersById = new Map(sdkResult.value.all.map(provider => [provider.id, provider]))
    const cliModels = cliResult.status === 'fulfilled'
      ? cliResult.value.map(descriptor => projectOpenCodeCliModel(
          input.runtimeKind,
          descriptor,
          providersById.get(descriptor.providerId),
        ))
      : []
    return {
      catalog: {
        runtimeKind: input.runtimeKind,
        source: 'opencode-sdk',
        fetchedAt: dependencies.now(),
        models: mergeOpenCodeModels(cliModels, sdkModels),
      },
      providerLabels: new Map(sdkResult.value.all.map(provider => [provider.id, provider.name || provider.id])),
    }
  }

  if (cliResult.status === 'fulfilled' && cliResult.value.length > 0) {
    return {
      catalog: {
        runtimeKind: input.runtimeKind,
        source: 'opencode-cli',
        fetchedAt: dependencies.now(),
        models: cliResult.value.map(descriptor => projectOpenCodeCliModel(input.runtimeKind, descriptor)),
      },
      providerLabels: new Map(cliResult.value.map(descriptor => [descriptor.providerId, descriptor.providerId])),
    }
  }

  throw createOpenCodeDiscoveryError(
    sdkResult.reason,
    cliResult.status === 'rejected' ? cliResult.reason : new Error('OpenCode CLI returned no models.'),
  )
}

async function listOpenCodeProviderInventory(
  input: {
    runtimeKind: RuntimeKind
    workspacePath?: string
    binaryPath: string
  },
  acquireRuntimeResource: typeof acquireOpencodeRuntimeResource,
): Promise<ProviderListResponse> {
  const lease = await acquireRuntimeResource({
    runtimeKind: input.runtimeKind,
    providerTargetId: OPENCODE_RUNTIME_NATIVE_PROVIDER_TARGET_ID,
    chatSessionId: OPENCODE_MODEL_CATALOG_SCOPE_ID,
    config: {} satisfies Config,
    directory: input.workspacePath,
    binaryPath: input.binaryPath,
  })
  try {
    const result = await lease.resource.client.provider.list({
      ...(input.workspacePath ? { query: { directory: input.workspacePath } } : {}),
    })
    if (result.error) {
      throw result.error
    }
    if (!result.data) {
      throw new Error('OpenCode provider list returned no data.')
    }
    return result.data
  }
  finally {
    lease.release()
  }
}

function filterConnectedOpenCodeProviders(providerList: ProviderListResponse): OpenCodeProvider[] {
  const connected = new Set(providerList.connected)
  return providerList.all.filter(provider => connected.has(provider.id))
}

function mergeOpenCodeModels(
  cliModels: RuntimeModelDescriptor[],
  sdkModels: RuntimeModelDescriptor[],
): RuntimeModelDescriptor[] {
  const modelsById = new Map(cliModels.map(model => [model.id, model]))
  for (const model of sdkModels) {
    modelsById.set(model.id, model)
  }
  return Array.from(modelsById.values()).sort((left, right) => left.label.localeCompare(right.label))
}

export async function listOpencodeCliModels(
  input: {
    binaryPath: string
    cwd: string
    timeoutMs?: number
  },
  runCommand: (input: {
    binaryPath: string
    cwd: string
    args: string[]
    timeoutMs: number
  }) => Promise<OpencodeCommandResult> = runOpencodeCommand,
): Promise<OpenCodeCliModelDescriptor[]> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS
  try {
    return await listOpencodeCliModelsFromArgs(input, ['models', '--verbose'], timeoutMs, runCommand)
  }
  catch (error) {
    if (!isUnsupportedVerboseModelsError(error)) {
      throw error
    }
    return await listOpencodeCliModelsFromArgs(input, ['models'], timeoutMs, runCommand)
  }
}

async function listOpencodeCliModelsFromArgs(
  input: { binaryPath: string, cwd: string },
  args: string[],
  timeoutMs: number,
  runCommand: (input: {
    binaryPath: string
    cwd: string
    args: string[]
    timeoutMs: number
  }) => Promise<OpencodeCommandResult>,
): Promise<OpenCodeCliModelDescriptor[]> {
  const result = await runCommand({ ...input, args, timeoutMs })
  if (result.code !== 0) {
    throw new OpencodeCliCommandError(input.binaryPath, args, result)
  }
  return parseOpenCodeCliModelsOutput(result.stdout)
}

export function runOpencodeCommand(input: {
  binaryPath: string
  cwd: string
  args: string[]
  timeoutMs: number
}): Promise<OpencodeCommandResult> {
  return new Promise((resolve, reject) => {
    const proc = spawnManagedProcess({
      kind: 'spawn',
      command: input.binaryPath,
      args: input.args,
      cwd: input.cwd,
      stdin: 'ignore',
      shutdownGraceMs: 1_500,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      void stopManagedCommand(proc).catch(() => undefined)
      reject(new Error(`OpenCode CLI timed out after ${input.timeoutMs}ms: ${input.binaryPath} ${input.args.join(' ')}`))
    }, input.timeoutMs)
    timeout.unref?.()

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    proc.once('error', (error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      reject(error)
    })
    proc.once('exit', (code) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      resolve({ stdout, stderr, code: code ?? 1 })
    })
  })
}

export function parseOpenCodeCliModelsOutput(output: string): OpenCodeCliModelDescriptor[] {
  const models = new Map<string, OpenCodeCliModelDescriptor>()
  let index = 0

  while (index < output.length) {
    const lineEnd = output.indexOf('\n', index)
    const nextLineIndex = lineEnd === -1 ? output.length : lineEnd + 1
    const candidate = output.slice(index, lineEnd === -1 ? output.length : lineEnd).trim()
    index = nextLineIndex
    const parsedSlug = parseOpenCodeModelSlug(candidate)
    if (!parsedSlug) {
      continue
    }

    let metadata: Record<string, unknown> = {}
    while (index < output.length && /\s/u.test(output[index]!)) {
      index += 1
    }
    if (output[index] === '{') {
      const block = readJsonObjectBlock(output, index)
      if (block) {
        try {
          metadata = readRecord(JSON.parse(block.json)) ?? {}
        }
        catch {
          metadata = {}
        }
        index = block.nextIndex
      }
    }

    models.set(candidate, projectOpenCodeCliDescriptor(candidate, parsedSlug, metadata))
  }

  return Array.from(models.values()).sort((left, right) => left.label.localeCompare(right.label))
}

function projectOpenCodeCliDescriptor(
  slug: string,
  parsedSlug: { providerId: string, modelId: string },
  metadata: Record<string, unknown>,
): OpenCodeCliModelDescriptor {
  const limit = readRecord(metadata.limit)
  const modalities = readRecord(metadata.modalities)
  const cost = readRecord(metadata.cost)
  const variants = readRecord(metadata.variants) ?? {}
  const contextWindow = readNumber(limit?.context)
  const maxOutput = readNumber(limit?.output)
  const inputModalities = readStringArray(modalities?.input)
  const outputModalities = readStringArray(modalities?.output)
  const releaseDate = readString(metadata.release_date)
  const inputCost = readNumber(cost?.input)
  const outputCost = readNumber(cost?.output)
  const cacheReadCost = readNumber(cost?.cache_read)
  const cacheWriteCost = readNumber(cost?.cache_write)
  const reasoningEfforts = Array.from(new Set(
    Object.entries(variants).flatMap(([key, value]) => {
      const variant = readRecord(value)
      const effort = variant ? readOpenCodeVariantReasoningEffort(key, variant as OpenCodeVariantConfig) : null
      return effort ? [effort] : []
    }),
  ))
  return {
    slug,
    providerId: parsedSlug.providerId,
    modelId: parsedSlug.modelId,
    label: readString(metadata.name) ?? parsedSlug.modelId,
    capabilities: {
      ...(contextWindow === null ? {} : { contextWindow }),
      ...(maxOutput === null ? {} : { maxOutput }),
      ...(inputModalities.length > 0 ? { inputModalities } : {}),
      ...(outputModalities.length > 0 ? { outputModalities } : {}),
      ...(typeof metadata.reasoning === 'boolean' ? { reasoning: metadata.reasoning } : {}),
      ...(reasoningEfforts.length > 0 ? { reasoningEfforts } : {}),
      ...(typeof metadata.tool_call === 'boolean' ? { toolCall: metadata.tool_call } : {}),
      ...(typeof metadata.temperature === 'boolean' ? { temperature: metadata.temperature } : {}),
      ...(cost
        ? {
            cost: {
              ...(inputCost === null ? {} : { input: inputCost }),
              ...(outputCost === null ? {} : { output: outputCost }),
              ...(cacheReadCost === null ? {} : { cacheRead: cacheReadCost }),
              ...(cacheWriteCost === null ? {} : { cacheWrite: cacheWriteCost }),
            },
          }
        : {}),
      ...(releaseDate ? { releaseDate } : {}),
    },
  }
}

export function flattenOpenCodeProviders(input: {
  runtimeKind: RuntimeKind
  providers: OpenCodeProvider[]
}): RuntimeModelDescriptor[] {
  return input.providers.flatMap(provider =>
    Object.values(provider.models)
      .map(model => projectOpenCodeModel(input.runtimeKind, provider, model))
      .sort((left, right) => left.label.localeCompare(right.label)))
}

function projectOpenCodeModel(
  runtimeKind: RuntimeKind,
  provider: OpenCodeProvider,
  model: OpenCodeModel,
): RuntimeModelDescriptor {
  const id = toOpenCodeModelRef(provider.id, model.id)
  const reasoningEfforts = readOpenCodeModelReasoningEfforts(model)
  return {
    id,
    label: model.name || id,
    providerKind: projectOpenCodeProviderKind(provider),
    capabilities: {
      contextWindow: model.limit.context,
      maxOutput: model.limit.output,
      ...(model.modalities?.input ? { inputModalities: model.modalities.input } : {}),
      ...(model.modalities?.output ? { outputModalities: model.modalities.output } : {}),
      reasoning: model.reasoning,
      ...(reasoningEfforts.length > 0 ? { reasoningEfforts } : {}),
      toolCall: model.tool_call,
      temperature: model.temperature,
      ...(model.cost
        ? {
            cost: {
              input: model.cost.input,
              output: model.cost.output,
              ...(model.cost.cache_read === undefined ? {} : { cacheRead: model.cost.cache_read }),
              ...(model.cost.cache_write === undefined ? {} : { cacheWrite: model.cost.cache_write }),
            },
          }
        : {}),
      releaseDate: model.release_date,
    },
    runtimeKind,
    source: 'opencode-sdk',
    nativeProviderId: provider.id,
  }
}

function projectOpenCodeCliModel(
  runtimeKind: RuntimeKind,
  descriptor: OpenCodeCliModelDescriptor,
  sdkProvider?: OpenCodeProvider,
): RuntimeModelDescriptor {
  return {
    id: descriptor.slug,
    label: descriptor.label,
    providerKind: sdkProvider ? projectOpenCodeProviderKind(sdkProvider) : 'universal',
    capabilities: descriptor.capabilities,
    runtimeKind,
    source: 'opencode-cli',
    nativeProviderId: descriptor.providerId,
  }
}

function readOpenCodeModelReasoningEfforts(model: OpenCodeModel): OpenCodeReasoningEffort[] {
  const variants = readOpenCodeModelVariants(model)
  return Array.from(new Set(
    Object.entries(variants).flatMap(([variantKey, variant]) => {
      const value = readOpenCodeVariantReasoningEffort(variantKey, variant)
      return value ? [value] : []
    }),
  ))
}

function readOpenCodeModelVariants(model: OpenCodeModel): Record<string, OpenCodeVariantConfig> {
  const variants = (model as OpenCodeModel & { variants?: unknown }).variants
  const record = readRecord(variants)
  if (!record) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, value]) => {
      const variant = readRecord(value)
      return variant ? [[key, variant as OpenCodeVariantConfig]] : []
    }),
  )
}

function readOpenCodeVariantReasoningEffort(
  variantKey: string,
  variant: OpenCodeVariantConfig,
): OpenCodeReasoningEffort | null {
  const value = trimToNull(variant.reasoningEffort)
    ?? trimToNull(variant.reasoning_effort)
    ?? trimToNull(variant.effort)
    ?? trimToNull(variant.thinkingConfig?.thinkingLevel)
    ?? trimToNull(variant.thinkingConfig?.thinking_level)
    ?? trimToNull(variant.thinking_config?.thinkingLevel)
    ?? trimToNull(variant.thinking_config?.thinking_level)
    ?? trimToNull(variant.reasoning?.effort)
    ?? trimToNull(variant.reasoningConfig?.maxReasoningEffort)
    ?? trimToNull(variant.reasoningConfig?.max_reasoning_effort)
    ?? trimToNull(variant.reasoning_config?.maxReasoningEffort)
    ?? trimToNull(variant.reasoning_config?.max_reasoning_effort)

  if (value) {
    return toOpenCodeReasoningEffort(value)
  }
  if (
    'thinking' in variant
    || 'thinkingConfig' in variant
    || 'thinking_config' in variant
    || 'reasoning' in variant
    || 'reasoningConfig' in variant
    || 'reasoning_config' in variant
    || Object.keys(variant).length === 0
  ) {
    return toOpenCodeReasoningEffort(variantKey)
  }
  return null
}

function toOpenCodeReasoningEffort(value: string): OpenCodeReasoningEffort | null {
  const normalized = value.trim()
  return OPENCODE_REASONING_EFFORTS.find(effort => effort === normalized) ?? null
}

function projectOpenCodeProviderKind(provider: OpenCodeProvider): ProviderKind {
  if (provider.api === 'anthropic') {
    return 'anthropic'
  }
  if (provider.api === 'openai' || provider.api === 'openai-compatible') {
    return 'openai-compatible'
  }
  return 'universal'
}

function parseOpenCodeModelSlug(slug: string): { providerId: string, modelId: string } | null {
  if (!/^[\w.@-]+\/\S+$/.test(slug)) {
    return null
  }
  const separator = slug.indexOf('/')
  return {
    providerId: slug.slice(0, separator),
    modelId: slug.slice(separator + 1),
  }
}

function readJsonObjectBlock(
  source: string,
  startIndex: number,
): { json: string, nextIndex: number } | null {
  let depth = 0
  let inString = false
  let escaping = false
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index]
    if (inString) {
      if (escaping) {
        escaping = false
      }
      else if (char === '\\') {
        escaping = true
      }
      else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
    }
    else if (char === '{') {
      depth += 1
    }
    else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return { json: source.slice(startIndex, index + 1), nextIndex: index + 1 }
      }
    }
  }
  return null
}

function isUnsupportedVerboseModelsError(error: unknown): boolean {
  if (!(error instanceof OpencodeCliCommandError)) {
    return false
  }
  const output = `${error.stdout}\n${error.stderr}`.toLowerCase()
  return /(?:unknown|unexpected) (?:argument|option):?\s+['"]?-{0,2}verbose/.test(output)
}

class OpencodeCliCommandError extends Error {
  readonly stdout: string
  readonly stderr: string

  constructor(binaryPath: string, args: string[], result: OpencodeCommandResult) {
    super([
      `OpenCode CLI exited with code ${result.code}: ${binaryPath} ${args.join(' ')}`,
      result.stdout.trim() ? `stdout:\n${result.stdout.trim()}` : null,
      result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : null,
    ].filter(value => value !== null).join('\n\n'))
    this.name = 'OpencodeCliCommandError'
    this.stdout = result.stdout
    this.stderr = result.stderr
  }
}

async function stopManagedCommand(proc: ManagedChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) {
    return
  }
  await proc.stop('SIGTERM')
}

function createOpenCodeDiscoveryError(sdkError: unknown, cliError: unknown): Error {
  return new Error([
    'OpenCode model discovery failed.',
    `SDK provider.list: ${formatError(sdkError)}`,
    `CLI models: ${formatError(cliError)}`,
  ].join('\n'))
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []
}

function trimToNull(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed || null
}

function toOpenCodeModelRef(providerId: string, modelId: string): string {
  return modelId.startsWith(`${providerId}/`) ? modelId : `${providerId}/${modelId}`
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  try {
    return JSON.stringify(error)
  }
  catch {
    return String(error)
  }
}
