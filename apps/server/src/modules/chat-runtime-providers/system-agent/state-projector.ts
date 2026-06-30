/**
 * Output: System Agent provider snapshot projections.
 * Input: existing provider snapshot and selected model id.
 * Position: System Agent provider package owner for providerStateSnapshot updates.
 */

import { readProviderStateSnapshot } from '../provider-state-snapshot'

export function projectSystemAgentModelSnapshot(rawSnapshot: string | null | undefined, currentModelId: string): string {
  const snapshot = readProviderStateSnapshot(rawSnapshot)
  return JSON.stringify({
    ...snapshot,
    models: { currentModelId },
  })
}
