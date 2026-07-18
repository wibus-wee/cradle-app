import fs from 'node:fs'
import path from 'node:path'

import { createChildLogger } from '../../logging/logger'
import { getPluginSkillProjectionSources, getPluginSkillRegistryVersion } from '../../plugins/skill-registry'
import { createAcpProvider } from '../chat-runtime-providers/acp/provider'
import { createClaudeAgentProvider } from '../chat-runtime-providers/claude-agent/provider'
import { createCodexProvider } from '../chat-runtime-providers/codex/provider'
import { reconcileCodexSessionUsage } from '../chat-runtime-providers/codex/usage-reconciliation'
import { createMockClaudeAgentProvider } from '../chat-runtime-providers/mock-claude-agent/provider'
import { createStandardProvider } from '../chat-runtime-providers/openai-compatible/provider'
import { createOpencodeProvider } from '../chat-runtime-providers/opencode/provider'
import { createSystemAgentProvider } from '../chat-runtime-providers/system-agent/provider'
import * as ModelRegistry from '../model-registry/service'
import { record as recordObservability } from '../observability/service'
import * as Preferences from '../preferences/service'
import {
  readRuntimeSessionLaunchMode,
  registerRuntimeGoalContinuationReader,
  registerRuntimeOwnedProviderTargets,
  registerRuntimeProviderBinding,
  registerRuntimeProviderKinds,
  registerRuntimeSessionLaunchMode,
} from '../provider-contracts/runtime-compatibility'
import type { RuntimeKind } from '../provider-contracts/types'
import { resolveProviderTargetForRuntime } from '../provider-targets/service'
import * as Secrets from '../secrets/service'
import { resolveNativeSkillPackageDir } from '../skills/native-skill-projection'
import { resolveScopeRoot } from '../skills/skills-paths'
import {
  CATALOG_ONLY_BUILTIN_RUNTIME_KINDS,
  CATALOG_ONLY_BUILTIN_RUNTIMES,
} from './catalog-only-runtime-metadata'
import { requestRuntimeToolApproval } from './pending-tool-approval'
import { requestRuntimeUserInput } from './pending-user-input'
import type {
  ChatRuntime,
  ChatRuntimeCapabilities,
  ChatRuntimeCapabilityDegradation,
  ChatRuntimeCatalogItem,
  ChatRuntimeHealthItem,
  ChatRuntimeMetadata,
  ProviderContext,
  ProviderHealthStatus,
  RuntimeComposerDescriptor,
} from './runtime-provider-types'
import { updateSessionRuntimeSettings as updateChatSessionRuntimeSettings } from './runtime-settings-api'

const SKILL_PATH_CACHE_TTL_MS = 30_000

interface SkillPathCacheEntry {
  paths: string[]
  expiresAt: number
  pluginSkillRegistryVersion: number
}

export class RuntimeRegistry {
  private readonly runtimes = new Map<RuntimeKind, {
    runtime: ChatRuntime
    metadata: ChatRuntimeMetadata
    pluginOwner: string | null
  }>()

  register(runtime: ChatRuntime, metadata?: ChatRuntimeMetadata, pluginOwner: string | null = null): void {
    assertChatRuntime(runtime)
    if (pluginOwner !== null && CATALOG_ONLY_BUILTIN_RUNTIME_KINDS.has(runtime.runtimeKind)) {
      throw new Error(`Runtime ${runtime.runtimeKind} is reserved by builtin catalog metadata.`)
    }
    const existing = this.runtimes.get(runtime.runtimeKind)
    const resolvedMetadata = metadata ?? runtime.metadata ?? existing?.metadata
    if (!resolvedMetadata) {
      throw new Error(`Runtime ${runtime.runtimeKind} must declare catalog metadata.`)
    }
    if (existing && (existing.pluginOwner !== null || pluginOwner !== null)) {
      throw new Error(`Runtime ${runtime.runtimeKind} is already registered by ${existing.pluginOwner ?? 'builtin'}.`)
    }
    this.runtimes.set(runtime.runtimeKind, {
      runtime,
      metadata: normalizeRuntimeMetadata(resolvedMetadata),
      pluginOwner,
    })
    registerRuntimeProviderKinds(runtime.runtimeKind, resolvedMetadata.providerKinds)
    registerRuntimeProviderBinding(runtime.runtimeKind, resolvedMetadata.providerBinding ?? 'required')
    registerRuntimeSessionLaunchMode(runtime.runtimeKind, resolvedMetadata.sessionLaunchMode ?? 'runtime-provider')
    registerRuntimeGoalContinuationReader(runtime.runtimeKind, runtime.goalContinuation)
    registerRuntimeOwnedProviderTargets(runtime.runtimeKind, runtime.ownedProviderTargets)
  }

  get(runtimeKind: RuntimeKind): ChatRuntime | undefined {
    return this.runtimes.get(runtimeKind)?.runtime
  }

  unregister(runtimeKind: RuntimeKind, pluginOwner: string): void {
    const entry = this.runtimes.get(runtimeKind)
    if (entry?.pluginOwner === pluginOwner) {
      this.runtimes.delete(runtimeKind)
      registerRuntimeProviderKinds(runtimeKind, [])
      registerRuntimeProviderBinding(runtimeKind, 'required')
      registerRuntimeSessionLaunchMode(runtimeKind, 'runtime-provider')
      registerRuntimeGoalContinuationReader(runtimeKind, null)
      registerRuntimeOwnedProviderTargets(runtimeKind, null)
    }
  }

  list(): ChatRuntimeCatalogItem[] {
    const items: ChatRuntimeCatalogItem[] = Array.from(this.runtimes.entries(), ([runtimeKind, entry]) =>
      createRuntimeCatalogItem({
        runtimeKind,
        metadata: entry.metadata,
        capabilities: cloneRuntimeCapabilities(entry.runtime.capabilities),
        source: entry.pluginOwner ? 'plugin' as const : 'builtin' as const,
        pluginOwner: entry.pluginOwner,
      }))

    const registeredRuntimeKinds = new Set(items.map(item => item.runtimeKind))
    for (const runtime of CATALOG_ONLY_BUILTIN_RUNTIMES) {
      if (registeredRuntimeKinds.has(runtime.runtimeKind)) {
        continue
      }
      items.push(createRuntimeCatalogItem({
        runtimeKind: runtime.runtimeKind,
        metadata: runtime.metadata,
        capabilities: null,
        source: 'builtin',
        pluginOwner: null,
      }))
    }

    return sortRuntimeCatalogItems(items)
  }

  async listDescriptors(): Promise<ChatRuntimeCatalogItem[]> {
    const items = this.list().filter(item => item.runtimeKind !== 'standard')
    const enriched = await Promise.all(items.map(async (item) => {
      const runtime = this.runtimes.get(item.runtimeKind)?.runtime
      if (!runtime?.getDraftPresentation) {
        return item
      }

      const presentation = await runtime.getDraftPresentation()
      return {
        ...item,
        slots: presentation.uiSlots,
      }
    }))

    return sortRuntimeCatalogItems(enriched)
  }

  async listHealth(): Promise<ChatRuntimeHealthItem[]> {
    const entries = [...this.runtimes.entries()]
    const items = await Promise.all(entries.map(async ([runtimeKind, entry]) => {
      const base = {
        runtimeKind,
        source: entry.pluginOwner ? 'plugin' as const : 'builtin' as const,
        pluginOwner: entry.pluginOwner,
        hasHealthCheck: typeof entry.runtime.healthCheck === 'function',
      }

      if (!entry.runtime.healthCheck) {
        return {
          ...base,
          status: 'unknown' as const,
          message: 'Runtime does not expose a health check.',
          lastCheckedAt: currentUnixSeconds(),
        }
      }

      const startedAt = Date.now()
      try {
        const status = await entry.runtime.healthCheck()
        return normalizeRuntimeHealthItem(base, status, Date.now() - startedAt)
      }
      catch (error) {
        return {
          ...base,
          status: 'unhealthy' as const,
          message: error instanceof Error ? error.message : String(error),
          latencyMs: Date.now() - startedAt,
          lastCheckedAt: currentUnixSeconds(),
        }
      }
    }))

    return items.sort((left, right) =>
      left.source.localeCompare(right.source)
      || left.runtimeKind.localeCompare(right.runtimeKind))
  }
}

function createRuntimeCatalogItem(input: {
  runtimeKind: RuntimeKind
  metadata: ChatRuntimeMetadata
  capabilities: ChatRuntimeCapabilities | null
  source: 'builtin' | 'plugin'
  pluginOwner: string | null
}): ChatRuntimeCatalogItem {
  const metadata = normalizeRuntimeMetadata(input.metadata)
  return {
    runtimeKind: input.runtimeKind,
    ...metadata,
    providerBinding: metadata.providerBinding ?? 'required',
    sessionLaunchMode: metadata.sessionLaunchMode ?? readRuntimeSessionLaunchMode(input.runtimeKind),
    icon: metadata.icon ?? { key: metadata.iconKey ?? 'custom' },
    availability: metadata.availability ?? (metadata.stability === 'experimental' ? 'preview' : 'stable'),
    composer: metadata.composer ?? createDefaultRuntimeComposer(metadata),
    slots: metadata.slots ?? [],
    degradations: mergeSteerDegradation(metadata.degradations, input.capabilities),
    capabilities: input.capabilities,
    source: input.source,
    pluginOwner: input.pluginOwner,
  }
}

const STEER_DEGRADATION_CAPABILITY = 'steerTurn'

/**
 * Real (non-decorative) consumer of `steer`: rather than requiring every provider to hand-declare
 * a `steerTurn` degradation entry (today none reliably do), derive it from the same
 * `capabilities.steer` value the server uses to decide native-vs-queue-fallback behavior, so the
 * catalog and the runtime behavior can never drift apart. A provider-declared `steerTurn` entry
 * (if any) always wins over the derived one.
 */
function mergeSteerDegradation(
  degradations: ChatRuntimeCapabilityDegradation[] | undefined,
  capabilities: ChatRuntimeCapabilities | null,
): ChatRuntimeCapabilityDegradation[] | undefined {
  if (degradations?.some(degradation => degradation.capability === STEER_DEGRADATION_CAPABILITY)) {
    return degradations
  }
  const derived = deriveSteerDegradation(capabilities)
  if (!derived) {
    return degradations
  }
  return degradations ? [...degradations, derived] : [derived]
}

function deriveSteerDegradation(
  capabilities: ChatRuntimeCapabilities | null,
): ChatRuntimeCapabilityDegradation | null {
  if (!capabilities || capabilities.steer === 'native') {
    return null
  }
  if (capabilities.steer === 'queue-fallback') {
    return {
      capability: STEER_DEGRADATION_CAPABILITY,
      status: 'partial',
      reason: 'This runtime has no native live-steer hook; steer requests are queued and applied on the next turn instead of redirecting the active turn immediately.',
    }
  }
  return {
    capability: STEER_DEGRADATION_CAPABILITY,
    status: 'unsupported',
    reason: 'This runtime does not support live steering or queuing a steer request.',
  }
}

function sortRuntimeCatalogItems(items: ChatRuntimeCatalogItem[]): ChatRuntimeCatalogItem[] {
  return [...items].sort((left, right) =>
    (left.sortOrder ?? 1000) - (right.sortOrder ?? 1000)
    || left.label.localeCompare(right.label)
    || left.runtimeKind.localeCompare(right.runtimeKind))
}

function createDefaultRuntimeComposer(metadata: ChatRuntimeMetadata): RuntimeComposerDescriptor {
  const providerBinding = metadata.providerBinding ?? 'required'
  return {
    inputMode: 'rich',
    modelSelection: providerBinding === 'runtime-owned' ? 'runtime-owned' : 'provider-model',
    thinking: 'per-model',
  }
}

function normalizeRuntimeMetadata(metadata: ChatRuntimeMetadata): ChatRuntimeMetadata {
  return {
    ...metadata,
    stability: metadata.stability ?? 'stable',
    providerKinds: [...metadata.providerKinds],
    surfaces: metadata.surfaces ? [...metadata.surfaces] : ['chat'],
    degradations: metadata.degradations?.map(degradation => ({ ...degradation })),
    slots: metadata.slots?.map(slot => ({
      ...slot,
      aliases: slot.aliases ? [...slot.aliases] : undefined,
      commandAction: slot.commandAction ? { ...slot.commandAction } : undefined,
      surfaces: [...slot.surfaces],
    })),
  }
}

function cloneRuntimeCapabilities(capabilities: ChatRuntimeCapabilities): ChatRuntimeCapabilities {
  return { ...capabilities }
}

export function assertChatRuntime(runtime: unknown): asserts runtime is ChatRuntime {
  if (!runtime || typeof runtime !== 'object') {
    throw new Error('Chat runtime must be an object.')
  }

  const candidate = runtime as Partial<ChatRuntime>
  if (typeof candidate.runtimeKind !== 'string' || candidate.runtimeKind.length === 0) {
    throw new Error('Chat runtime must declare runtimeKind.')
  }
  if (!candidate.metadata || !Array.isArray(candidate.metadata.providerKinds)) {
    throw new Error(`Runtime ${candidate.runtimeKind} must declare metadata with providerKinds.`)
  }
  if (!candidate.capabilities || typeof candidate.capabilities !== 'object') {
    throw new Error(`Runtime ${candidate.runtimeKind} must declare static capabilities.`)
  }

  assertRuntimeFunction(candidate, 'startChatSession')
  assertRuntimeFunction(candidate, 'resumeChatSession')
  assertRuntimeFunction(candidate, 'streamTurn')
  assertRuntimeFunction(candidate, 'cancelTurn')
  assertRuntimeCapabilities(candidate)
}

function assertRuntimeFunction(runtime: Partial<ChatRuntime>, key: keyof ChatRuntime): void {
  if (typeof runtime[key] !== 'function') {
    throw new TypeError(`Runtime ${runtime.runtimeKind ?? '<unknown>'} must implement ${key}.`)
  }
}

function assertRuntimeCapabilities(runtime: Partial<ChatRuntime>): void {
  const capabilities = runtime.capabilities
  if (!capabilities) {
    throw new Error(`Runtime ${runtime.runtimeKind ?? '<unknown>'} must declare static capabilities.`)
  }

  const booleanKeys = [
    'supportsShellExecution',
    'supportsLastTurnRollback',
    'supportsRuntimeSettings',
    'supportsUiSlotStates',
    'supportsDynamicCapabilities',
    'supportsTitleGeneration',
  ] as const
  for (const key of booleanKeys) {
    if (typeof capabilities[key] !== 'boolean') {
      throw new TypeError(`Runtime ${runtime.runtimeKind} capability ${key} must be boolean.`)
    }
  }
  if (!['native', 'queue-fallback', 'unsupported'].includes(capabilities.steer)) {
    throw new Error(`Runtime ${runtime.runtimeKind} has invalid steer capability.`)
  }
  if (!['in-session', 'restart-session', 'unsupported'].includes(capabilities.sessionModelSwitch)) {
    throw new Error(`Runtime ${runtime.runtimeKind} has invalid sessionModelSwitch capability.`)
  }

  assertCapabilityHook(runtime, capabilities.steer === 'native', 'steerTurn')
  assertCapabilityHook(runtime, capabilities.supportsShellExecution, 'executeShellCommand')
  assertCapabilityHook(runtime, capabilities.supportsLastTurnRollback, 'rollbackLastTurn')
  assertCapabilityHook(runtime, capabilities.supportsRuntimeSettings, 'updateRuntimeSettings')
  assertCapabilityHook(runtime, capabilities.supportsUiSlotStates, 'getUiSlotStates')
  assertCapabilityHook(runtime, capabilities.supportsDynamicCapabilities, 'getDynamicCapabilities')
  assertCapabilityHook(runtime, capabilities.supportsTitleGeneration, 'generateSessionTitle')
}

function assertCapabilityHook(runtime: Partial<ChatRuntime>, supported: boolean, key: keyof ChatRuntime): void {
  if (supported && typeof runtime[key] !== 'function') {
    throw new Error(`Runtime ${runtime.runtimeKind} declares ${key} support but does not implement the hook.`)
  }
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function normalizeRuntimeHealthItem(
  base: Pick<ChatRuntimeHealthItem, 'runtimeKind' | 'source' | 'pluginOwner' | 'hasHealthCheck'>,
  status: ProviderHealthStatus,
  measuredLatencyMs: number,
): ChatRuntimeHealthItem {
  return {
    ...base,
    ...status,
    status: status.status,
    latencyMs: status.latencyMs ?? Math.round(measuredLatencyMs),
    lastCheckedAt: status.lastCheckedAt || currentUnixSeconds(),
  }
}

const skillPathCache = new Map<string, SkillPathCacheEntry>()

/** Resolve all skill folder paths that should be given to a runtime for a workspace. */
export function resolveRuntimeSkillPaths(workspacePath: string): string[] {
  const now = Date.now()
  const pluginSkillRegistryVersion = getPluginSkillRegistryVersion()
  const cached = skillPathCache.get(workspacePath)
  if (cached && cached.expiresAt > now && cached.pluginSkillRegistryVersion === pluginSkillRegistryVersion) {
    return [...cached.paths]
  }

  const roots = [
    resolveScopeRoot('builtin', {}),
    resolveScopeRoot('workspace', { workspacePath }),
  ]
  const paths: string[] = []
  const seenPaths = new Set<string>()
  const pushPath = (skillDir: string): void => {
    if (seenPaths.has(skillDir)) {
      return
    }
    seenPaths.add(skillDir)
    paths.push(skillDir)
  }

  for (const root of roots) {
    if (!fs.existsSync(root)) {
      continue
    }
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue
      }
      const skillDir = path.join(root, entry.name)
      if (fs.existsSync(path.join(skillDir, 'SKILL.md'))) {
        pushPath(skillDir)
      }
    }
  }

  for (const source of getPluginSkillProjectionSources()) {
    try {
      pushPath(resolveNativeSkillPackageDir(source.skillFile))
    }
    catch {
      // Invalid plugin skill packages are ignored here; native projection reports conflicts separately.
    }
  }

  skillPathCache.set(workspacePath, {
    paths,
    expiresAt: now + SKILL_PATH_CACHE_TTL_MS,
    pluginSkillRegistryVersion,
  })
  return [...paths]
}

let registry: RuntimeRegistry | null = null

function createProviderContext(): ProviderContext {
  return {
    readSecret: ref => Secrets.readSecret(ref),
    readSecretValueWithMetadata: ref => Secrets.readSecretValueWithMetadata(ref),
    updateSecret: (ref, val) => Secrets.updateSecretValue(ref, val),
    resolveSkillPaths: resolveRuntimeSkillPaths,
    updateSessionRuntimeSettings: async (input) => {
      await updateChatSessionRuntimeSettings(input)
    },
    requestUserInput: requestRuntimeUserInput,
    requestToolApproval: requestRuntimeToolApproval,
    recordObservability,
    logger: createChildLogger({ module: 'chat-runtime-provider' }),
  }
}

export function getRuntimeRegistry(): RuntimeRegistry {
  if (!registry) {
    registry = new RuntimeRegistry()
    const ctx = createProviderContext()
    registry.register(createAcpProvider(ctx))
    registry.register(createStandardProvider(ctx))
    registry.register(createOpencodeProvider(ctx))
    if (process.env.CRADLE_MOCK_LLM_URL) {
      registry.register(createMockClaudeAgentProvider(ctx))
    }
    else {
      registry.register(createClaudeAgentProvider(ctx))
    }
    registry.register(createCodexProvider(ctx, {
      readCodexPreferences: () => Preferences.getCodexPreferencesSync(),
      readCodexCliCompatibleIdentity: () => Preferences.isAppFeatureFlagEnabled('codexCliCompatibleIdentity'),
      readChatPreferences: () => Preferences.getChatPreferencesSync(),
      reconcileUsage: async (input) => {
        await reconcileCodexSessionUsage(input)
      },
      resolveProviderTargetProfile: (providerTargetId) => {
        const target = resolveProviderTargetForRuntime(providerTargetId, 'codex')
        if (!target.enabled) {
          return null
        }
        const config = JSON.parse(target.configJson) as Record<string, unknown>
        return {
          id: target.id,
          name: target.label,
          providerKind: target.providerKind,
          enabled: target.enabled,
          configJson: JSON.stringify({
            ...config,
            modelRegistryMappings: ModelRegistry.listMappingEntries(),
          }),
          credentialRef: target.credentialRef,
          customModels: target.customModelsJson,
          iconSlug: target.iconSlug,
          providerTargetKind: target.kind,
          providerTargetId: target.id,
        }
      },
    }))
    registry.register(createSystemAgentProvider(ctx))
  }
  return registry
}

export function registerRuntime(runtime: ChatRuntime, metadata?: ChatRuntimeMetadata, pluginOwner: string | null = null): void {
  getRuntimeRegistry().register(runtime, metadata, pluginOwner)
}

export function unregisterRuntime(runtimeKind: RuntimeKind, pluginOwner: string): void {
  getRuntimeRegistry().unregister(runtimeKind, pluginOwner)
}

export function listRuntimeCatalog(): ChatRuntimeCatalogItem[] {
  return getRuntimeRegistry().list()
}

export async function listRuntimeDescriptors(): Promise<ChatRuntimeCatalogItem[]> {
  return await getRuntimeRegistry().listDescriptors()
}

export async function listRuntimeHealth(): Promise<ChatRuntimeHealthItem[]> {
  return await getRuntimeRegistry().listHealth()
}
