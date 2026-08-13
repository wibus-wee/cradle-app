import type { WorkspaceProviderStateSnapshot } from '../../kit/state-snapshot'
import { readWorkspaceProviderStateSnapshot } from '../../kit/state-snapshot'
import type { CodexGoalSnapshot, CodexThreadTokenUsage } from '../types'

export interface CodexNativeContextUsageCheckpoint {
  threadId: string
  total: NonNullable<CodexThreadTokenUsage['total']>
  last: NonNullable<CodexThreadTokenUsage['last']>
  modelContextWindow: number | null
  updatedAt: number
}

export interface CodexDurableCheckpointState {
  durableVersion: 1
  contextUsage: CodexNativeContextUsageCheckpoint | null
  goal?: CodexGoalSnapshot | null
}

export interface CodexDurableCheckpoint extends WorkspaceProviderStateSnapshot {
  codex: CodexDurableCheckpointState
}

export interface DecodedCodexDurableCheckpoint {
  checkpoint: CodexDurableCheckpoint
  serialized: string
  didNormalize: boolean
}

interface LegacyCodexCheckpointSource {
  durableVersion?: number
  contextUsage?: CodexNativeContextUsageCheckpoint | null
  goal?: CodexGoalSnapshot | null
  compact?: {
    threadId?: string
    tokenUsage?: CodexThreadTokenUsage
    updatedAt?: number
  }
}

export function decodeCodexDurableCheckpoint(
  raw: string | null | undefined,
): DecodedCodexDurableCheckpoint {
  const source = readWorkspaceProviderStateSnapshot(raw) as WorkspaceProviderStateSnapshot & {
    codex?: LegacyCodexCheckpointSource
  }
  const checkpoint: CodexDurableCheckpoint = {
    schemaVersion: source.schemaVersion,
    models: source.models,
    ...(source.workspacePath !== undefined ? { workspacePath: source.workspacePath } : {}),
    ...(source.agentId !== undefined ? { agentId: source.agentId } : {}),
    ...(source.agentHome !== undefined ? { agentHome: source.agentHome } : {}),
    ...('harness' in source ? { harness: source.harness } : {}),
    codex: {
      durableVersion: 1,
      contextUsage: readCodexContextUsageCheckpoint(source.codex),
      ...(source.codex?.goal !== undefined ? { goal: source.codex.goal } : {}),
    },
  }
  const serialized = JSON.stringify(checkpoint)
  return {
    checkpoint,
    serialized,
    didNormalize: (raw ?? '') !== serialized,
  }
}

function readCodexContextUsageCheckpoint(
  source: LegacyCodexCheckpointSource | undefined,
): CodexNativeContextUsageCheckpoint | null {
  if (source?.durableVersion === 1 && source.contextUsage) {
    return source.contextUsage
  }
  const compact = source?.compact
  const tokenUsage = compact?.tokenUsage
  if (!compact?.threadId || !tokenUsage?.total || !tokenUsage.last) {
    return null
  }
  return {
    threadId: compact.threadId,
    total: tokenUsage.total,
    last: tokenUsage.last,
    modelContextWindow: tokenUsage.modelContextWindow ?? null,
    updatedAt: compact.updatedAt ?? 0,
  }
}
