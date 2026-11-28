import type { ModelDescriptor } from '../provider-contracts/types'

/**
 * Context windows declared by a provider target's own model inventory.
 *
 * The models.dev registry answers "how large is this model", which is a global
 * fact and often missing for gateway-specific ids (`magpie` pools accounts, so
 * its ids look like `codex/gpt-6.2-sol`). A gateway's own `/v1/models` answers
 * "how much will this endpoint accept", which is the number a run must compact
 * against — so provider-declared windows win over the registry guess here.
 *
 * The map is scoped by provider target because two targets may serve the same
 * model id with different served windows; a single model-id keyed cache cannot
 * tell them apart.
 *
 * `provider-catalog` seeds this map whenever it writes a target's inventory and
 * once more at boot from the persisted cache, so lookups stay in-memory and
 * nothing puts catalog I/O on the first-token path.
 */
const contextWindowsByTarget = new Map<string, Map<string, number>>()

/** Replace one target's windows so models the inventory no longer lists drop out. */
export function replaceProviderTargetContextWindows(
  providerTargetId: string,
  models: Pick<ModelDescriptor, 'id' | 'capabilities'>[],
): void {
  const windows = new Map<string, number>()
  for (const model of models) {
    const contextWindow = model.capabilities.contextWindow
    if (typeof contextWindow === 'number' && contextWindow > 0) {
      windows.set(model.id, Math.trunc(contextWindow))
    }
  }
  if (windows.size === 0) {
    contextWindowsByTarget.delete(providerTargetId)
    return
  }
  contextWindowsByTarget.set(providerTargetId, windows)
}

export function clearProviderTargetContextWindows(providerTargetId: string): void {
  contextWindowsByTarget.delete(providerTargetId)
}

export function clearAllProviderTargetContextWindows(): void {
  contextWindowsByTarget.clear()
}

/** Served window for one model on one target; null when the target never declared it. */
export function getProviderTargetContextWindow(
  providerTargetId: string | null | undefined,
  modelId: string,
): number | null {
  if (!providerTargetId) {
    return null
  }
  return contextWindowsByTarget.get(providerTargetId)?.get(modelId) ?? null
}
