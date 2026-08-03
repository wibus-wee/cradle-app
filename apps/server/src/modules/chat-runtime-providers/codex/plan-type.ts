/**
 * Codex account plan-type helpers.
 * Keeps Cradle display/normalization aligned with the generated PlanType union,
 * including newer arms such as `ent26` from Codex 0.146.
 */

import type { PlanType } from './app-server-protocol/PlanType'

export const KNOWN_CODEX_PLAN_TYPES = [
  'free',
  'go',
  'plus',
  'pro',
  'prolite',
  'team',
  'self_serve_business_usage_based',
  'business',
  'ent26',
  'enterprise_cbp_usage_based',
  'enterprise',
  'edu',
  'unknown',
] as const satisfies readonly PlanType[]

export function isKnownCodexPlanType(value: string): value is PlanType {
  return (KNOWN_CODEX_PLAN_TYPES as readonly string[]).includes(value)
}

/** Normalize raw plan strings from JWT/config without inventing fallbacks. */
export function normalizeCodexPlanType(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() || null
  return normalized
}
