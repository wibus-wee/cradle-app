import { readProviderStateSnapshot } from '../kit/state-snapshot'

export function projectSystemAgentModelSnapshot(rawSnapshot: string | null | undefined, currentModelId: string): string {
  const snapshot = readProviderStateSnapshot(rawSnapshot)
  return JSON.stringify({
    ...snapshot,
    models: { currentModelId },
  })
}
