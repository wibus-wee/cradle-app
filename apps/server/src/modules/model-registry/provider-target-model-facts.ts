import type { ModelDescriptor } from '../provider-contracts/types'

/**
 * Model facts a provider target declared through its own inventory.
 *
 * The models.dev registry answers "how large is this model" and "which efforts
 * does it accept", which are global facts and often missing for gateway-specific
 * ids (magpie pools accounts, so its ids look like `codex/gpt-6.2-sol`). A
 * gateway's own `/v1/models` answers "how much will this endpoint accept, and at
 * which service tiers", which is what a run must use — so provider-declared
 * facts win over the registry guess here.
 *
 * The maps are scoped by provider target because two targets may serve the same
 * model id with different served windows and different tiers; a single
 * model-id keyed cache cannot tell them apart.
 *
 * `provider-catalog` publishes here whenever it writes a target's inventory and
 * once more at boot from the persisted cache, so lookups stay in-memory and
 * nothing puts catalog I/O on the first-token path.
 */
interface TargetModelFacts {
  contextWindows: Map<string, number>
  serviceTierIds: Map<string, string[]>
}

const factsByTarget = new Map<string, TargetModelFacts>()

/** Replace one target's facts so models the inventory no longer lists drop out. */
export function replaceProviderTargetModelFacts(
  providerTargetId: string,
  models: Pick<ModelDescriptor, 'id' | 'capabilities'>[],
): void {
  const facts: TargetModelFacts = {
    contextWindows: new Map(),
    serviceTierIds: new Map(),
  }
  for (const model of models) {
    const contextWindow = model.capabilities.contextWindow
    if (typeof contextWindow === 'number' && contextWindow > 0) {
      facts.contextWindows.set(model.id, Math.trunc(contextWindow))
    }
    const tierIds = model.capabilities.serviceTiers?.map(tier => tier.id).filter(Boolean)
    if (tierIds?.length) {
      facts.serviceTierIds.set(model.id, [...new Set(tierIds)])
    }
  }
  if (facts.contextWindows.size === 0 && facts.serviceTierIds.size === 0) {
    factsByTarget.delete(providerTargetId)
    return
  }
  factsByTarget.set(providerTargetId, facts)
}

export function clearProviderTargetModelFacts(providerTargetId: string): void {
  factsByTarget.delete(providerTargetId)
}

export function clearAllProviderTargetModelFacts(): void {
  factsByTarget.clear()
}

/** Served window for one model on one target; null when the target never declared it. */
export function getProviderTargetContextWindow(
  providerTargetId: string | null | undefined,
  modelId: string,
): number | null {
  if (!providerTargetId) {
    return null
  }
  return factsByTarget.get(providerTargetId)?.contextWindows.get(modelId) ?? null
}

/**
 * Served service tier ids for one model on one target. Empty means the target
 * never declared a tier for this model, so the run must not request one.
 */
export function getProviderTargetServiceTierIds(
  providerTargetId: string | null | undefined,
  modelId: string,
): string[] {
  if (!providerTargetId) {
    return []
  }
  return factsByTarget.get(providerTargetId)?.serviceTierIds.get(modelId) ?? []
}
