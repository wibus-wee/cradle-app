import { describe, expect, it } from 'vitest'

import type { PlanType } from './app-server-protocol/PlanType'
import {
  isKnownCodexPlanType,
  KNOWN_CODEX_PLAN_TYPES,
  normalizeCodexPlanType,
} from './plan-type'

describe('codex plan type', () => {
  it('includes the Codex 0.146 ent26 plan arm', () => {
    expect(KNOWN_CODEX_PLAN_TYPES).toContain('ent26')
    expect(isKnownCodexPlanType('ent26')).toBe(true)

    const ent26: PlanType = 'ent26'
    expect(ent26).toBe('ent26')
  })

  it('normalizes plan strings without collapsing unknown values', () => {
    expect(normalizeCodexPlanType('ENT26')).toBe('ent26')
    expect(normalizeCodexPlanType(' Pro ')).toBe('pro')
    expect(normalizeCodexPlanType('custom-plan')).toBe('custom-plan')
    expect(normalizeCodexPlanType(null)).toBeNull()
  })
})
