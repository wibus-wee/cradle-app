import type { RuntimeCatalogItem } from '~/features/agent-runtime/runtime-catalog'
import { runtimeCatalogItemUsesModelSelection } from '~/features/agent-runtime/runtime-catalog'
import type { ProviderTarget } from '~/features/agent-runtime/types'
import type { Agent, UpdateAgentInput } from '~/features/agent-runtime/use-agents'

export type AgentBatchThinkingEffort = 'low' | 'medium' | 'high' | 'xhigh'

export interface AgentProviderBatchSelection {
  providerTarget: ProviderTarget
  modelId: string | null
  thinkingEffort: AgentBatchThinkingEffort
}

export interface AgentBatchProviderPatch {
  id: string
  patch: UpdateAgentInput
}

export interface AgentBatchProviderPatchResult {
  patches: AgentBatchProviderPatch[]
  skippedRuntimeOwnedCount: number
}

function agentUsesProviderTarget(agent: Agent, runtimeCatalog: RuntimeCatalogItem[]): boolean {
  const runtime = runtimeCatalog.find(item => item.runtimeKind === agent.runtimeKind)
  return runtime ? runtimeCatalogItemUsesModelSelection(runtime) : true
}

export function buildAgentProviderBatchPatches(
  agents: Agent[],
  selection: AgentProviderBatchSelection,
  runtimeCatalog: RuntimeCatalogItem[],
): AgentBatchProviderPatchResult {
  if (selection.modelId === null) {
    throw new Error('Provider-backed batch configuration requires a resolved model')
  }

  const patches: AgentBatchProviderPatch[] = []
  let skippedRuntimeOwnedCount = 0

  for (const agent of agents) {
    if (!agentUsesProviderTarget(agent, runtimeCatalog)) {
      skippedRuntimeOwnedCount += 1
      continue
    }

    patches.push({
      id: agent.id,
      patch: {
        name: agent.name,
        description: agent.description,
        avatarStyle: agent.avatarStyle,
        avatarSeed: agent.avatarSeed,
        providerTargetId: selection.providerTarget.id,
        modelId: selection.modelId,
        thinkingEffort: selection.thinkingEffort,
        runtimeKind: agent.runtimeKind,
        configJson: agent.configJson,
        enabled: agent.enabled,
      },
    })
  }

  return { patches, skippedRuntimeOwnedCount }
}
