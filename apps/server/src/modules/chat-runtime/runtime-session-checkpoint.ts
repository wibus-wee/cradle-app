import type { RuntimeSession } from './runtime-provider-types'

const checkpointRevisionBySession = new WeakMap<RuntimeSession, number>()

export function replaceRuntimeSessionProviderCheckpoint(
  runtimeSession: RuntimeSession,
  serializedCheckpoint: string | null,
): void {
  if (runtimeSession.providerStateSnapshot === serializedCheckpoint) {
    return
  }
  runtimeSession.providerStateSnapshot = serializedCheckpoint
  checkpointRevisionBySession.set(
    runtimeSession,
    readRuntimeSessionProviderCheckpointRevision(runtimeSession) + 1,
  )
}

export function readRuntimeSessionProviderCheckpointRevision(
  runtimeSession: RuntimeSession,
): number {
  return checkpointRevisionBySession.get(runtimeSession) ?? 0
}
