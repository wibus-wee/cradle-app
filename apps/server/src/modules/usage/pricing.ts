import { getCachedModelsDevCost } from '../model-registry/model-info-registry'

/** USD per 1M tokens */
interface ModelPricing {
  input: number
  output: number
}

/**
 * Hardcoded fallback pricing for models not yet in the models.dev cache.
 * Only used when the registry cache is cold or has no cost data for the model.
 */
const FALLBACK_PRICING: Record<string, ModelPricing> = {
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4.1': { input: 2.00, output: 8.00 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'gpt-4.1-nano': { input: 0.10, output: 0.40 },
  'o3': { input: 2.00, output: 8.00 },
  'o3-mini': { input: 1.10, output: 4.40 },
  'o4-mini': { input: 1.10, output: 4.40 },
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
  'claude-opus-4-20250514': { input: 15.00, output: 75.00 },
  'gemini-2.5-pro': { input: 1.25, output: 10.00 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'deepseek-chat': { input: 0.27, output: 1.10 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
}

function findFallbackPricing(modelId: string): ModelPricing | null {
  if (FALLBACK_PRICING[modelId]) {
    return FALLBACK_PRICING[modelId]!
  }
  // Longest prefix match
  const sortedKeys = Object.keys(FALLBACK_PRICING).sort((a, b) => b.length - a.length)
  for (const key of sortedKeys) {
    if (modelId.startsWith(key)) {
      return FALLBACK_PRICING[key]!
    }
  }
  return null
}

export function estimateCost(
  modelId: string,
  usage: { promptTokens: number, completionTokens: number },
): number {
  const pricing = getCachedModelsDevCost(modelId) ?? findFallbackPricing(modelId)
  if (!pricing) {
    return 0
  }
  return (usage.promptTokens * pricing.input + usage.completionTokens * pricing.output) / 1_000_000
}
