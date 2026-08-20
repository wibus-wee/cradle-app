import { readProviderStateSnapshot } from '../../chat-runtime-providers/kit/state-snapshot'
import type {
  RuntimeHarnessFragment,
  RuntimeSession,
} from '../runtime-provider-types'
import { replaceRuntimeSessionProviderCheckpoint } from '../runtime-session-checkpoint'

interface HarnessProjectionSnapshot {
  providerSessionId: string | null
  revisions: Record<string, string>
}

interface ProviderSnapshotWithHarness {
  harness?: HarnessProjectionSnapshot
}

export function resolvePendingHarnessFragments(
  runtimeSession: RuntimeSession,
  fragments: RuntimeHarnessFragment[] | undefined,
): RuntimeHarnessFragment[] {
  if (!fragments?.length) {
    return []
  }

  const harness = readHarnessProjectionSnapshot(runtimeSession)
  const providerSessionChanged = harness.providerSessionId !== runtimeSession.providerSessionId
  return fragments.filter(fragment => (
    providerSessionChanged || harness.revisions[fragment.key] !== fragment.revision
  ))
}

export function markHarnessFragmentsProjected(
  runtimeSession: RuntimeSession,
  fragments: RuntimeHarnessFragment[],
): void {
  if (fragments.length === 0) {
    return
  }
  const harness = readHarnessProjectionSnapshot(runtimeSession)
  writeHarnessProjectionSnapshot(runtimeSession, {
    providerSessionId: runtimeSession.providerSessionId,
    revisions: {
      ...harness.revisions,
      ...Object.fromEntries(fragments.map(fragment => [fragment.key, fragment.revision])),
    },
  })
}

export function bindHarnessProjectionToProviderSession(
  runtimeSession: RuntimeSession,
  providerSessionId: string,
): void {
  const harness = readHarnessProjectionSnapshot(runtimeSession)
  writeHarnessProjectionSnapshot(runtimeSession, {
    ...harness,
    providerSessionId,
  })
}

export function invalidateHarnessProjection(runtimeSession: RuntimeSession): void {
  writeHarnessProjectionSnapshot(runtimeSession, {
    providerSessionId: runtimeSession.providerSessionId,
    revisions: {},
  })
}

function readHarnessProjectionSnapshot(runtimeSession: RuntimeSession): HarnessProjectionSnapshot {
  const snapshot = readProviderStateSnapshot(runtimeSession.providerStateSnapshot) as ProviderSnapshotWithHarness
  return {
    providerSessionId: snapshot.harness?.providerSessionId ?? null,
    revisions: snapshot.harness?.revisions ?? {},
  }
}

function writeHarnessProjectionSnapshot(
  runtimeSession: RuntimeSession,
  harness: HarnessProjectionSnapshot,
): void {
  const snapshot = readProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  replaceRuntimeSessionProviderCheckpoint(runtimeSession, JSON.stringify({
    ...snapshot,
    harness,
  }))
}
