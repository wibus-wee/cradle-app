import { describe, expect, it } from 'vitest'

import { resolvePendingFirstRunSetupSteps } from './credential-setup-store'

describe('resolvePendingFirstRunSetupSteps', () => {
  it('returns both steps when nothing is completed or satisfied', () => {
    expect(resolvePendingFirstRunSetupSteps({
      completedSteps: {},
      providerSatisfied: false,
      githubSatisfied: false,
    })).toEqual(['provider', 'github'])
  })

  it('omits environmentally satisfied steps without requiring a stored key', () => {
    expect(resolvePendingFirstRunSetupSteps({
      completedSteps: {},
      providerSatisfied: true,
      githubSatisfied: false,
    })).toEqual(['github'])
  })

  it('omits stored completed step keys', () => {
    expect(resolvePendingFirstRunSetupSteps({
      completedSteps: { provider: true },
      providerSatisfied: false,
      githubSatisfied: false,
    })).toEqual(['github'])
  })

  it('returns empty when every step is completed or satisfied', () => {
    expect(resolvePendingFirstRunSetupSteps({
      completedSteps: { github: true },
      providerSatisfied: true,
      githubSatisfied: false,
    })).toEqual([])
  })
})
