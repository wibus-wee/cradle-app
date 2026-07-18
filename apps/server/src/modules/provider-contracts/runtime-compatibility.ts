import {
  CLI_TUI_RUNTIME_KIND,
  CLI_TUI_RUNTIME_METADATA,
} from '../chat-runtime/catalog-only-runtime-metadata'
import type {
  RuntimeModelDescriptor,
  RuntimeOwnedProviderTarget,
  RuntimeOwnedProviderTargets,
} from '../chat-runtime/runtime-provider-types'
import {
  ACP_RUNTIME_KIND,
  ACP_RUNTIME_METADATA,
} from '../chat-runtime-providers/acp/metadata'
import {
  CLAUDE_AGENT_RUNTIME_KIND,
  CLAUDE_AGENT_RUNTIME_METADATA,
} from '../chat-runtime-providers/claude-agent/metadata'
import {
  CODEX_RUNTIME_KIND,
  CODEX_RUNTIME_METADATA,
} from '../chat-runtime-providers/codex/metadata'
import {
  STANDARD_RUNTIME_KIND,
  STANDARD_RUNTIME_METADATA,
} from '../chat-runtime-providers/openai-compatible/metadata'
import {
  OPENCODE_RUNTIME_KIND,
  OPENCODE_RUNTIME_METADATA,
} from '../chat-runtime-providers/opencode/metadata'
import { OPENCODE_RUNTIME_OWNED_PROVIDER_TARGETS } from '../chat-runtime-providers/opencode/owned-provider-targets'
import {
  SYSTEM_AGENT_RUNTIME_ACTOR,
  SYSTEM_AGENT_RUNTIME_KIND,
  SYSTEM_AGENT_RUNTIME_METADATA,
} from '../chat-runtime-providers/system-agent/metadata'
import type { ProviderKind, RuntimeKind } from './types'

export type RuntimeProviderBinding = 'required' | 'runtime-owned' | 'none'
export type RuntimeSessionLaunchMode = 'runtime-provider' | 'agent-terminal'

export interface RuntimeDefaultActorDescriptor {
  kind: 'system'
  id: string
  issueLabel?: string
}

export interface RuntimeGoalContinuationStateReader {
  readContinuableGoal: (input: {
    providerStateSnapshot: string | null | undefined
    options?: {
      includeBlockedGoals?: boolean
    }
  }) => { objective: string, status: string } | null
}

interface RuntimeCompatibilityMetadata {
  providerKinds: readonly ProviderKind[]
  providerBinding?: RuntimeProviderBinding
  sessionLaunchMode?: RuntimeSessionLaunchMode
}

const BUILTIN_RUNTIME_COMPATIBILITY: Array<{
  runtimeKind: RuntimeKind
  metadata: RuntimeCompatibilityMetadata
  defaultActor?: RuntimeDefaultActorDescriptor
  ownedProviderTargets?: RuntimeOwnedProviderTargets
}> = [
  { runtimeKind: STANDARD_RUNTIME_KIND, metadata: STANDARD_RUNTIME_METADATA },
  { runtimeKind: CLAUDE_AGENT_RUNTIME_KIND, metadata: CLAUDE_AGENT_RUNTIME_METADATA },
  { runtimeKind: CODEX_RUNTIME_KIND, metadata: CODEX_RUNTIME_METADATA },
  {
    runtimeKind: OPENCODE_RUNTIME_KIND,
    metadata: OPENCODE_RUNTIME_METADATA,
    ownedProviderTargets: OPENCODE_RUNTIME_OWNED_PROVIDER_TARGETS,
  },
  { runtimeKind: SYSTEM_AGENT_RUNTIME_KIND, metadata: SYSTEM_AGENT_RUNTIME_METADATA, defaultActor: SYSTEM_AGENT_RUNTIME_ACTOR },
  { runtimeKind: ACP_RUNTIME_KIND, metadata: ACP_RUNTIME_METADATA },
  { runtimeKind: CLI_TUI_RUNTIME_KIND, metadata: CLI_TUI_RUNTIME_METADATA },
]

const runtimeProviderKinds = new Map<RuntimeKind, readonly ProviderKind[]>(
  BUILTIN_RUNTIME_COMPATIBILITY.map(({ runtimeKind, metadata }) => [runtimeKind, [...metadata.providerKinds]]),
)
const runtimeProviderBindings = new Map<RuntimeKind, RuntimeProviderBinding>(
  BUILTIN_RUNTIME_COMPATIBILITY.map(({ runtimeKind, metadata }) => [runtimeKind, metadata.providerBinding ?? 'required']),
)
const runtimeSessionLaunchModes = new Map<RuntimeKind, RuntimeSessionLaunchMode>(
  BUILTIN_RUNTIME_COMPATIBILITY.map(({ runtimeKind, metadata }) => [runtimeKind, metadata.sessionLaunchMode ?? 'runtime-provider']),
)
const runtimeUniversalProviderKinds = new Map<RuntimeKind, ProviderKind>(
  BUILTIN_RUNTIME_COMPATIBILITY
    .flatMap(({ runtimeKind, metadata }) => {
      const providerKind = projectRuntimeUniversalProviderKind(metadata.providerKinds)
      return providerKind ? [[runtimeKind, providerKind] as const] : []
    }),
)
const runtimeDefaultActors = new Map<RuntimeKind, RuntimeDefaultActorDescriptor>(
  BUILTIN_RUNTIME_COMPATIBILITY
    .flatMap(({ runtimeKind, defaultActor }) => defaultActor ? [[runtimeKind, defaultActor] as const] : []),
)
const runtimeOwnedProviderTargets = new Map<RuntimeKind, RuntimeOwnedProviderTargets>(
  BUILTIN_RUNTIME_COMPATIBILITY
    .flatMap(({ runtimeKind, ownedProviderTargets }) => ownedProviderTargets ? [[runtimeKind, ownedProviderTargets] as const] : []),
)
const runtimeGoalContinuationReaders = new Map<RuntimeKind, RuntimeGoalContinuationStateReader>()

export function registerRuntimeProviderKinds(runtimeKind: RuntimeKind, providerKinds: readonly ProviderKind[]): void {
  runtimeProviderKinds.set(runtimeKind, [...providerKinds])
  const universalProviderKind = projectRuntimeUniversalProviderKind(providerKinds)
  if (universalProviderKind) {
    runtimeUniversalProviderKinds.set(runtimeKind, universalProviderKind)
    return
  }
  runtimeUniversalProviderKinds.delete(runtimeKind)
}

export function registerRuntimeProviderBinding(runtimeKind: RuntimeKind, providerBinding: RuntimeProviderBinding): void {
  runtimeProviderBindings.set(runtimeKind, providerBinding)
}

export function registerRuntimeSessionLaunchMode(runtimeKind: RuntimeKind, launchMode: RuntimeSessionLaunchMode): void {
  runtimeSessionLaunchModes.set(runtimeKind, launchMode)
}

export function registerRuntimeOwnedProviderTargets(
  runtimeKind: RuntimeKind,
  targets: RuntimeOwnedProviderTargets | null | undefined,
): void {
  if (!targets) {
    runtimeOwnedProviderTargets.delete(runtimeKind)
    return
  }
  runtimeOwnedProviderTargets.set(runtimeKind, targets)
}

export function registerRuntimeGoalContinuationReader(
  runtimeKind: RuntimeKind,
  reader: RuntimeGoalContinuationStateReader | null | undefined,
): void {
  if (!reader) {
    runtimeGoalContinuationReaders.delete(runtimeKind)
    return
  }
  runtimeGoalContinuationReaders.set(runtimeKind, reader)
}

export function listProviderKindsForRuntime(runtimeKind: RuntimeKind): readonly ProviderKind[] {
  return runtimeProviderKinds.get(runtimeKind) ?? []
}

export function readRuntimeUniversalProviderKind(runtimeKind: RuntimeKind): ProviderKind | null {
  return runtimeUniversalProviderKinds.get(runtimeKind) ?? null
}

export function readRuntimeProviderBinding(runtimeKind: RuntimeKind): RuntimeProviderBinding {
  return runtimeProviderBindings.get(runtimeKind) ?? 'required'
}

export function runtimeOwnsProviderBinding(runtimeKind: RuntimeKind): boolean {
  return readRuntimeProviderBinding(runtimeKind) === 'runtime-owned'
}

export function runtimeSkipsProviderTarget(runtimeKind: RuntimeKind): boolean {
  const binding = readRuntimeProviderBinding(runtimeKind)
  return binding === 'runtime-owned' || binding === 'none'
}

export function readRuntimeSessionLaunchMode(runtimeKind: RuntimeKind): RuntimeSessionLaunchMode {
  return runtimeSessionLaunchModes.get(runtimeKind) ?? 'runtime-provider'
}

export function runtimeUsesAgentTerminalLaunch(runtimeKind: RuntimeKind): boolean {
  return readRuntimeSessionLaunchMode(runtimeKind) === 'agent-terminal'
}

export function readRuntimeDefaultActor(runtimeKind: RuntimeKind | null | undefined): RuntimeDefaultActorDescriptor | null {
  return runtimeKind ? runtimeDefaultActors.get(runtimeKind) ?? null : null
}

export function readRuntimeIssueActorLabel(runtimeKind: RuntimeKind | null | undefined): string {
  return readRuntimeDefaultActor(runtimeKind)?.issueLabel ?? 'Agent'
}

export function readRuntimeOwnedProviderTargetOwner(providerTargetId: string | null | undefined): RuntimeKind | null {
  if (!providerTargetId) {
    return null
  }
  for (const [runtimeKind, targets] of runtimeOwnedProviderTargets) {
    if (targets.ownsProviderTargetId(providerTargetId)) {
      return runtimeKind
    }
  }
  return null
}

export function runtimeOwnsProviderTarget(runtimeKind: RuntimeKind, providerTargetId: string | null | undefined): boolean {
  if (!providerTargetId) {
    return false
  }
  return runtimeOwnedProviderTargets.get(runtimeKind)?.ownsProviderTargetId(providerTargetId) ?? false
}

export function projectRuntimeOwnedProviderTarget(input: {
  providerTargetId: string
  runtimeKind?: RuntimeKind
  now: number
}): RuntimeOwnedProviderTarget | null {
  const runtimeKind = input.runtimeKind ?? readRuntimeOwnedProviderTargetOwner(input.providerTargetId)
  const targets = runtimeKind ? runtimeOwnedProviderTargets.get(runtimeKind) : undefined
  return targets?.projectProviderTarget({
    providerTargetId: input.providerTargetId,
    now: input.now,
  }) ?? null
}

export async function listRuntimeOwnedProviderTargets(input: {
  runtimeKind: RuntimeKind
  workspacePath?: string
  now: number
}): Promise<RuntimeOwnedProviderTarget[]> {
  const targets = runtimeOwnedProviderTargets.get(input.runtimeKind)
  if (!targets?.listProviderTargets) {
    return []
  }
  return await targets.listProviderTargets(input)
}

export async function listRuntimeOwnedProviderTargetModels(input: {
  providerTargetId: string | null | undefined
  runtimeKind?: RuntimeKind
  workspacePath?: string
}): Promise<RuntimeModelDescriptor[] | null> {
  if (!input.providerTargetId) {
    return null
  }
  const runtimeKind = input.runtimeKind ?? readRuntimeOwnedProviderTargetOwner(input.providerTargetId)
  if (!runtimeKind) {
    return null
  }
  const targets = runtimeOwnedProviderTargets.get(runtimeKind)
  if (!targets?.listModelsForProviderTarget || !targets.ownsProviderTargetId(input.providerTargetId)) {
    return null
  }
  return await targets.listModelsForProviderTarget({
    runtimeKind,
    providerTargetId: input.providerTargetId,
    workspacePath: input.workspacePath,
  })
}

export function runtimeHasContinuableGoal(input: {
  runtimeKind: RuntimeKind
  providerStateSnapshot: string | null | undefined
  includeBlockedGoals?: boolean
}): boolean {
  if (!input.providerStateSnapshot) {
    return false
  }
  return runtimeGoalContinuationReaders.get(input.runtimeKind)?.readContinuableGoal({
    providerStateSnapshot: input.providerStateSnapshot,
    options: {
      includeBlockedGoals: input.includeBlockedGoals,
    },
  }) !== null
}

export function runtimeSupportsProviderKind(runtimeKind: RuntimeKind, providerKind: ProviderKind): boolean {
  return listProviderKindsForRuntime(runtimeKind).includes(providerKind)
}

function projectRuntimeUniversalProviderKind(providerKinds: readonly ProviderKind[]): ProviderKind | null {
  const concreteProviderKinds = providerKinds.filter(providerKind => providerKind !== 'universal')
  return providerKinds.includes('universal') && concreteProviderKinds.length === 1
    ? concreteProviderKinds[0]
    : null
}
