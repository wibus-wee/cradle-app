export interface ProviderStateSnapshot {
  models: {
    currentModelId: string | null
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface WorkspaceProviderStateSnapshot extends ProviderStateSnapshot {
  workspacePath?: string
  agentId?: string | null
  agentHome?: string | null
}

export function readProviderStateSnapshot(raw: string | null | undefined): ProviderStateSnapshot {
  const snapshot = raw ? JSON.parse(raw) as ProviderStateSnapshot : { models: { currentModelId: null } }
  return {
    ...snapshot,
    models: {
      ...snapshot.models,
      currentModelId: snapshot.models?.currentModelId ?? null,
    },
  }
}

export function readWorkspaceProviderStateSnapshot(raw: string | null | undefined): WorkspaceProviderStateSnapshot {
  return readProviderStateSnapshot(raw) as WorkspaceProviderStateSnapshot
}
