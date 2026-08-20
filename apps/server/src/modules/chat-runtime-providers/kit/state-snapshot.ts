/**
 * Trusted provider runtime state snapshot parsing, shared by every provider that persists
 * `backend_state_snapshot` (models.currentModelId plus provider-private fields).
 *
 * Provider-specific codecs own provider-private migrations. The shared reader only
 * normalizes the common envelope so unrelated providers cannot collide on versions.
 */

export const PROVIDER_STATE_SNAPSHOT_SCHEMA_VERSION = 1 as const

export interface ProviderStateSnapshot {
  schemaVersion?: number
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
  const snapshot = raw
    ? (JSON.parse(raw) as ProviderStateSnapshot)
    : { models: { currentModelId: null } }
  const normalized: ProviderStateSnapshot = {
    ...snapshot,
    models: {
      ...snapshot.models,
      currentModelId: snapshot.models?.currentModelId ?? null,
    },
  }
  return { ...normalized, schemaVersion: PROVIDER_STATE_SNAPSHOT_SCHEMA_VERSION }
}

export function readWorkspaceProviderStateSnapshot(
  raw: string | null | undefined,
): WorkspaceProviderStateSnapshot {
  return readProviderStateSnapshot(raw) as WorkspaceProviderStateSnapshot
}
