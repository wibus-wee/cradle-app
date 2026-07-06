/**
 * Trusted provider runtime state snapshot parsing, shared by every provider that persists
 * `backend_state_snapshot` (models.currentModelId plus provider-private fields).
 *
 * `schemaVersion` + `registerProviderStateSnapshotMigration` give providers a documented path
 * for evolving their snapshot shape without silently losing fields on old persisted rows —
 * register a migration keyed by the schema version it upgrades *from*, and it runs
 * automatically the next time that provider's snapshot is read.
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

export type ProviderStateSnapshotMigration = (
  snapshot: ProviderStateSnapshot,
) => ProviderStateSnapshot

const migrations = new Map<number, ProviderStateSnapshotMigration>()

/** Register a migration that upgrades a snapshot from `fromSchemaVersion` to the next version. */
export function registerProviderStateSnapshotMigration(
  fromSchemaVersion: number,
  migrate: ProviderStateSnapshotMigration,
): void {
  migrations.set(fromSchemaVersion, migrate)
}

function migrateSnapshot(snapshot: ProviderStateSnapshot): ProviderStateSnapshot {
  let current = snapshot
  let version = current.schemaVersion ?? 0
  while (version < PROVIDER_STATE_SNAPSHOT_SCHEMA_VERSION) {
    const migrate = migrations.get(version)
    if (!migrate) {
      break
    }
    current = migrate(current)
    version += 1
  }
  return { ...current, schemaVersion: PROVIDER_STATE_SNAPSHOT_SCHEMA_VERSION }
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
  return migrateSnapshot(normalized)
}

export function readWorkspaceProviderStateSnapshot(
  raw: string | null | undefined,
): WorkspaceProviderStateSnapshot {
  return readProviderStateSnapshot(raw) as WorkspaceProviderStateSnapshot
}
